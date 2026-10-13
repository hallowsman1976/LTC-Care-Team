import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decryptText } from '../src/crypto';

const script = fileURLToPath(new URL('../../../scripts/seed-demo/enroll-totp.mjs', import.meta.url));

describe('TOTP enrolment script', () => {
  it('encrypts the secret so the Worker can decrypt it for that user only', async () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    const output = JSON.parse(execFileSync(process.execPath, [script, 'usr-demo-cm', 'cm', '--json'], { env: { ...process.env, MFA_ENCRYPTION_KEY_BASE64: key } }).toString()) as
      { secret: string; ciphertext: string; sql: string; otpauth: string };
    expect(output.secret).toMatch(/^[A-Z2-7]{32}$/);
    await expect(decryptText(output.ciphertext, key, 'smart-ltc:totp:usr-demo-cm:v1')).resolves.toBe(output.secret);
    await expect(decryptText(output.ciphertext, key, 'smart-ltc:totp:usr-demo-cg:v1')).rejects.toThrow();
    expect(output.sql).toContain("VALUES ('usr-demo-cm',");
    expect(output.otpauth).toContain(`secret=${output.secret}`);
  });

  it('refuses a user id that could break out of the SQL literal', () => {
    expect(() => execFileSync(process.execPath, [script, "x'); DROP TABLE sessions; --"], { env: { ...process.env, MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32).toString('base64') }, stdio: 'pipe' })).toThrow();
  });
});
