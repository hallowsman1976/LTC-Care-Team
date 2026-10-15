#!/usr/bin/env node
// Sends the Worker secrets from generate-secrets.mjs to Cloudflare with `wrangler secret put`,
// passing each value on stdin so it never appears in the command line or the terminal.
// Usage (repository root, after `npx wrangler login`): node scripts/pilot/push-worker-secrets.mjs <secrets-file>
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/pilot/push-worker-secrets.mjs <secrets-file>');
  process.exit(2);
}
const { worker } = JSON.parse(readFileSync(file, 'utf8'));
const names = ['GATEWAY_ASSERTION_SECRET', 'CID_ENCRYPTION_KEY_BASE64', 'CID_LOOKUP_SECRET', 'MFA_ENCRYPTION_KEY_BASE64'];
for (const name of names) {
  const value = worker?.[name];
  if (typeof value !== 'string' || value.length < 40) {
    console.error(`${file} has no usable ${name}.`);
    process.exit(2);
  }
}

for (const name of names) {
  console.log(`Setting ${name}…`);
  // shell is needed for npx on Windows; the name is from the fixed list above, the value goes via stdin.
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: worker[name], stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`wrangler failed for ${name}; nothing after it was set.`);
    process.exit(result.status ?? 1);
  }
}
console.log('All Worker secrets are set. Each one creates a new Worker version immediately.');
