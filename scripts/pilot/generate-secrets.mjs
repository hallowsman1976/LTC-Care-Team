#!/usr/bin/env node
// Generates every secret the PILOT needs and writes them to one local JSON file (never printed).
// Usage: node scripts/pilot/generate-secrets.mjs [output-file]   (default: pilot.secrets.local.json)
//
// Keep a copy of that file in the organisation's password manager or an encrypted vault before
// you delete it: without CID_ENCRYPTION_KEY_BASE64 the encrypted citizen IDs cannot be read again.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const output = process.argv[2] ?? 'pilot.secrets.local.json';
if (existsSync(output)) {
  console.error(`${output} already exists. Move it away first: overwriting it would lose the keys it holds.`);
  process.exit(2);
}

const base64 = (bytes) => randomBytes(bytes).toString('base64');
const secrets = {
  createdAt: new Date().toISOString(),
  // Cloudflare Worker secrets (scripts/pilot/push-worker-secrets.mjs sends these).
  worker: {
    GATEWAY_ASSERTION_SECRET: base64(48),
    CID_ENCRYPTION_KEY_BASE64: base64(32),
    CID_LOOKUP_SECRET: base64(48),
    MFA_ENCRYPTION_KEY_BASE64: base64(32)
  },
  // Apps Script → Project Settings → Script Properties (paste by hand).
  gasScriptProperties: {
    GATEWAY_ASSERTION_SECRET: null,
    PASSWORD_PEPPER: base64(48)
  }
};
// GAS verifies the Worker's signature with the same value.
secrets.gasScriptProperties.GATEWAY_ASSERTION_SECRET = secrets.worker.GATEWAY_ASSERTION_SECRET;

writeFileSync(output, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote ${output} (not shown here).`);
console.log('Next:');
console.log('  1. Copy the file into the organisation\'s password manager or encrypted vault.');
console.log(`  2. node scripts/pilot/push-worker-secrets.mjs ${output}`);
console.log('  3. Paste gasScriptProperties into Apps Script → Project Settings → Script Properties.');
console.log('  4. Delete the local file once both are done and the vault copy is confirmed.');
