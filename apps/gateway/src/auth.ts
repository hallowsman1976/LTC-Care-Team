import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Actor } from '@smart-ltc/shared';
import { requireSecret, type Env } from './env';
import { callGas } from './gasProxy';
import { decryptText, encryptText, sha256Hex } from './crypto';
import { gasData, HttpError } from './errors';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyGoogleToken(idToken: string, env: Env): Promise<string> {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_IDENTITY_INVALID');
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID
    }));
  } catch {
    throw new Error('GOOGLE_IDENTITY_INVALID');
  }
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw new Error('GOOGLE_IDENTITY_INVALID');
  if (env.GOOGLE_HOSTED_DOMAIN && String(payload.hd ?? '').toLowerCase() !== env.GOOGLE_HOSTED_DOMAIN.toLowerCase()) throw new Error('HOSTED_DOMAIN_REQUIRED');
  return payload.sub;
}

export async function verifyPasswordAtGas(identifier: string, password: string, env: Env): Promise<Actor> {
  return gasData<Actor>(await callGas(env, 'anonymous', 'auth.passwordVerify', { identifier, password }));
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index + 5 <= bits.length; index += 5) output += BASE32[Number.parseInt(bits.slice(index, index + 5), 2)];
  return output;
}

function base32Decode(value: string): Uint8Array {
  const alphabet = BASE32;
  const clean = value.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('INVALID_TOTP_SECRET');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return new Uint8Array(bytes);
}

/** RFC 6238 code for a 30-second counter. Exported for the enrolment script and tests. */
export async function totpCode(secret: string, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', base32Decode(secret).slice().buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | ((digest[offset + 1] ?? 0) << 16) | ((digest[offset + 2] ?? 0) << 8) | (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Accepts a code from the previous, current or next 30-second step, but never a step at or before
 * the last one this user consumed, so an observed code cannot be replayed.
 */
export async function verifyTotp(userId: string, code: string, env: Env): Promise<boolean> {
  const row = await env.SECURITY_DB.prepare('SELECT totp_secret_ciphertext FROM user_security WHERE user_id = ? AND mfa_enabled = 1')
    .bind(userId).first<{ totp_secret_ciphertext: string }>();
  if (!row) throw new Error('MFA_ENROLLMENT_REQUIRED');
  const secret = await decryptText(row.totp_secret_ciphertext, requireSecret(env, 'MFA_ENCRYPTION_KEY_BASE64'), totpContext(userId));
  const now = Math.floor(Date.now() / 30_000);
  const lastUsedKey = `totp-last:${userId}`;
  const lastUsed = Number(await env.SECURITY_KV.get(lastUsedKey) ?? '-1');
  for (const counter of [now - 1, now, now + 1]) {
    if (counter <= lastUsed || await totpCode(secret, counter) !== code) continue;
    await env.SECURITY_KV.put(lastUsedKey, String(counter), { expirationTtl: 300 });
    return true;
  }
  return false;
}

const totpContext = (userId: string) => `smart-ltc:totp:${userId}:v1`;

export async function hasTotp(userId: string, env: Env): Promise<boolean> {
  const row = await env.SECURITY_DB.prepare('SELECT 1 AS found FROM user_security WHERE user_id = ? AND mfa_enabled = 1').bind(userId).first();
  return Boolean(row);
}

interface PendingEnrollment { actor: Actor; secretCiphertext: string; attempts: number }

const ENROLLMENT_TTL_SECONDS = 600;
const ENROLLMENT_MAX_ATTEMPTS = 5;
const enrollmentKey = async (token: string) => `mfa-enroll:${await sha256Hex(token)}`;

export interface EnrollmentChallenge { status: 'MFA_ENROLLMENT_REQUIRED'; enrollmentToken: string; secret: string; otpauthUri: string; accountLabel: string }

/**
 * After a correct password for a user without TOTP: a fresh secret, held encrypted in KV for ten
 * minutes until the user proves their authenticator app produces its codes. Nothing is stored in
 * D1 and no session exists until then.
 */
export async function startTotpEnrollment(actor: Actor, accountLabel: string, issuer: string, env: Env): Promise<EnrollmentChallenge> {
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  const secretCiphertext = await encryptText(secret, requireSecret(env, 'MFA_ENCRYPTION_KEY_BASE64'), totpContext(actor.userId));
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const enrollmentToken = Array.from(tokenBytes, (value) => value.toString(16).padStart(2, '0')).join('');
  const pending: PendingEnrollment = { actor, secretCiphertext, attempts: 0 };
  await env.SECURITY_KV.put(await enrollmentKey(enrollmentToken), JSON.stringify(pending), { expirationTtl: ENROLLMENT_TTL_SECONDS });
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { status: 'MFA_ENROLLMENT_REQUIRED', enrollmentToken, secret, otpauthUri, accountLabel };
}

/**
 * Stores the pending secret once the user enters a current code from it. Refuses when the user
 * already has TOTP (a second enrolment would let a password alone replace the second factor).
 */
export async function completeTotpEnrollment(enrollmentToken: string, code: string, env: Env): Promise<Actor> {
  const key = await enrollmentKey(enrollmentToken);
  const raw = enrollmentToken ? await env.SECURITY_KV.get(key) : null;
  if (!raw) throw new HttpError(400, 'MFA_ENROLLMENT_EXPIRED', 'หมดเวลาลงทะเบียน กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
  const pending = JSON.parse(raw) as PendingEnrollment;
  const { userId } = pending.actor;
  if (await hasTotp(userId, env)) {
    await env.SECURITY_KV.delete(key);
    throw new HttpError(409, 'MFA_ALREADY_ENROLLED', 'บัญชีนี้ลงทะเบียนรหัสยืนยันไว้แล้ว กรุณาเข้าสู่ระบบใหม่');
  }
  const secret = await decryptText(pending.secretCiphertext, requireSecret(env, 'MFA_ENCRYPTION_KEY_BASE64'), totpContext(userId));
  const now = Math.floor(Date.now() / 30_000);
  let matched: number | null = null;
  for (const counter of [now - 1, now, now + 1]) if (await totpCode(secret, counter) === code) matched = counter;
  if (matched === null) {
    pending.attempts += 1;
    if (pending.attempts >= ENROLLMENT_MAX_ATTEMPTS) await env.SECURITY_KV.delete(key);
    else await env.SECURITY_KV.put(key, JSON.stringify(pending), { expirationTtl: ENROLLMENT_TTL_SECONDS });
    throw new Error('MFA_INVALID');
  }
  await env.SECURITY_DB.prepare('INSERT INTO user_security (user_id, totp_secret_ciphertext, mfa_enabled, recovery_codes_json, updated_at) VALUES (?, ?, 1, ?, ?)')
    .bind(userId, pending.secretCiphertext, '[]', new Date().toISOString()).run();
  await env.SECURITY_KV.put(`totp-last:${userId}`, String(matched), { expirationTtl: 300 });
  await env.SECURITY_KV.delete(key);
  return pending.actor;
}

/** Removes a user's TOTP and ends their sessions; they enrol again at their next sign-in. */
export async function resetTotp(userId: string, env: Env): Promise<void> {
  await env.SECURITY_DB.prepare('DELETE FROM user_security WHERE user_id = ?').bind(userId).run();
  await env.SECURITY_DB.prepare("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND json_extract(session_json, '$.actor.userId') = ?")
    .bind(new Date().toISOString(), userId).run();
  await env.SECURITY_KV.delete(`totp-last:${userId}`);
}

const LOGIN_WINDOW_SECONDS = 900;
const limits = (request: Request, identifier: string) => {
  const normalized = identifier.toLowerCase();
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  // Per source address, plus a looser per-account ceiling against guessing from many addresses.
  return [{ key: `login:${ip}:${normalized}`, max: 5 }, { key: `login-id:${normalized}`, max: 20 }];
};

export async function enforceLoginRateLimit(request: Request, identifier: string, env: Env): Promise<void> {
  for (const { key, max } of limits(request, identifier)) {
    const attempts = Number(await env.SECURITY_KV.get(key) ?? '0');
    if (attempts >= max) throw new HttpError(429, 'LOGIN_RATE_LIMITED', 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที');
    await env.SECURITY_KV.put(key, String(attempts + 1), { expirationTtl: LOGIN_WINDOW_SECONDS });
  }
}

export async function resetLoginRateLimit(request: Request, identifier: string, env: Env): Promise<void> {
  await Promise.all(limits(request, identifier).map(({ key }) => env.SECURITY_KV.delete(key)));
}
