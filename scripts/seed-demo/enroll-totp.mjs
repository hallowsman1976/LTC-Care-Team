#!/usr/bin/env node
// Generates a TOTP secret for one user, encrypted the way apps/gateway/src/crypto.ts expects, and
// prints the D1 statement to store it plus the otpauth:// URI for an authenticator app.
// Usage: MFA_ENCRYPTION_KEY_BASE64=... node scripts/seed-demo/enroll-totp.mjs <userId> [label] [--json]
import { webcrypto } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index + 5 <= bits.length; index += 5) output += BASE32[Number.parseInt(bits.slice(index, index + 5), 2)];
  return output;
}

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

async function encryptText(value, keyBase64, context) {
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(keyBase64, 'base64'), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(value));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const [userId, label = userId] = args.filter((arg) => arg !== '--json');
const keyBase64 = process.env.MFA_ENCRYPTION_KEY_BASE64;
if (!userId || !/^[\w.-]+$/.test(userId)) {
  console.error('usage: MFA_ENCRYPTION_KEY_BASE64=... node scripts/seed-demo/enroll-totp.mjs <userId> [label] [--json]');
  process.exit(2);
}
if (!keyBase64 || Buffer.from(keyBase64, 'base64').length !== 32) {
  console.error('MFA_ENCRYPTION_KEY_BASE64 must be a base64-encoded 32-byte key (the same value the Worker uses).');
  process.exit(2);
}

const secret = base32(webcrypto.getRandomValues(new Uint8Array(20)));
const ciphertext = await encryptText(secret, keyBase64, `smart-ltc:totp:${userId}:v1`);
const sql = `INSERT OR REPLACE INTO user_security (user_id, totp_secret_ciphertext, mfa_enabled, recovery_codes_json, updated_at) VALUES ('${userId}', '${ciphertext}', 1, '[]', '${new Date().toISOString()}');`;
const otpauth = `otpauth://totp/${encodeURIComponent(`Smart LTC Demo:${label}`)}?secret=${secret}&issuer=${encodeURIComponent('Smart LTC Demo')}&algorithm=SHA1&digits=6&period=30`;

if (json) {
  console.log(JSON.stringify({ userId, secret, ciphertext, sql, otpauth }));
} else {
  console.log('1) Store the encrypted secret in D1 (run from the repository root):');
  console.log(`   npx wrangler d1 execute smart-ltc-security-demo --remote --command "${sql}"`);
  console.log('\n2) Add this URI to the user\'s authenticator app (or render it as a QR code), then discard it:');
  console.log(`   ${otpauth}`);
}
