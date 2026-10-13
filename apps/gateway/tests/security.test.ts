import { describe, expect, it } from 'vitest';
import { isSupportedBrowser } from '../src/browser';
import { decryptCid, encryptCid } from '../src/crypto';
import { assertOperationalMode, type Env } from '../src/env';

describe('browser matrix', () => {
  it('rejects old browsers and accepts the declared floor', () => {
    expect(isSupportedBrowser('Mozilla/5.0 Chrome/108.0.0.0 Safari/537.36')).toBe(false);
    expect(isSupportedBrowser('Mozilla/5.0 Chrome/109.0.0.0 Safari/537.36')).toBe(true);
  });
});

describe('CID encryption', () => {
  it('round trips with AES-GCM and does not expose plaintext', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const encrypted = await encryptCid('0000000000000', key);
    expect(encrypted).not.toContain('0000000000000');
    await expect(decryptCid(encrypted, key)).resolves.toBe('0000000000000');
  });
});

describe('pilot configuration gate', () => {
  it('rejects placeholders and accepts an explicitly configured pilot', () => {
    const base = {
      APP_MODE: 'PILOT', APP_ORIGIN: 'https://ltc.example.go.th',
      GAS_EXEC_URL: 'https://script.google.com/macros/s/real-deployment/exec',
      GATEWAY_ASSERTION_SECRET: 'a'.repeat(32), CID_LOOKUP_SECRET: 'b'.repeat(32),
      CID_ENCRYPTION_KEY_BASE64: 'c'.repeat(44), MFA_ENCRYPTION_KEY_BASE64: 'd'.repeat(44),
      GOOGLE_CLIENT_ID: '123456.apps.googleusercontent.com', GOOGLE_HOSTED_DOMAIN: 'health.example.go.th'
    } as Env;
    expect(() => assertOperationalMode({ ...base, GOOGLE_CLIENT_ID: 'replace-with-google-client-id' })).toThrow('INVALID_CONFIG:GOOGLE_CLIENT_ID');
    expect(() => assertOperationalMode(base)).not.toThrow();
  });
});
