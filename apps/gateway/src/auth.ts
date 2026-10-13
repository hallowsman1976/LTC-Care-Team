import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Actor, ApiEnvelope } from '@smart-ltc/shared';
import type { Env } from './env';
import { callGas } from './gasProxy';
import { decryptText } from './crypto';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyGoogleToken(idToken: string, env: Env): Promise<string> {
  const { payload } = await jwtVerify(idToken, googleKeys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID
  });
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw new Error('GOOGLE_IDENTITY_INVALID');
  if (env.GOOGLE_HOSTED_DOMAIN && String(payload.hd ?? '').toLowerCase() !== env.GOOGLE_HOSTED_DOMAIN.toLowerCase()) throw new Error('HOSTED_DOMAIN_REQUIRED');
  return payload.sub;
}

export async function verifyPasswordAtGas(identifier: string, password: string, env: Env): Promise<Actor> {
  const response = await callGas(env, 'anonymous', 'auth.passwordVerify', { identifier, password });
  const result = await response.json() as ApiEnvelope<Actor>;
  if (!result.ok || !result.data) throw new Error('INVALID_CREDENTIALS');
  return result.data;
}

function base32Decode(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
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

async function totpAt(secret: string, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', base32Decode(secret).slice().buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | ((digest[offset + 1] ?? 0) << 16) | ((digest[offset + 2] ?? 0) << 8) | (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

export async function verifyTotp(userId: string, code: string, env: Env): Promise<boolean> {
  const row = await env.SECURITY_DB.prepare('SELECT totp_secret_ciphertext FROM user_security WHERE user_id = ? AND mfa_enabled = 1')
    .bind(userId).first<{ totp_secret_ciphertext: string }>();
  if (!row) throw new Error('MFA_ENROLLMENT_REQUIRED');
  const secret = await decryptText(row.totp_secret_ciphertext, env.MFA_ENCRYPTION_KEY_BASE64, `smart-ltc:totp:${userId}:v1`);
  const counter = Math.floor(Date.now() / 30_000);
  const expected = await Promise.all([-1, 0, 1].map((offset) => totpAt(secret, counter + offset)));
  return expected.includes(code);
}

export async function enforceLoginRateLimit(request: Request, identifier: string, env: Env): Promise<void> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const key = `login:${ip}:${identifier.toLowerCase()}`;
  const attempts = Number(await env.SECURITY_KV.get(key) ?? '0');
  if (attempts >= 5) throw new Error('LOGIN_RATE_LIMITED');
  await env.SECURITY_KV.put(key, String(attempts + 1), { expirationTtl: 900 });
}
