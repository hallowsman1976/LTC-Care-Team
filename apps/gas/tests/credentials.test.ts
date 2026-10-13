import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';
import { setDemoCredential } from '../src/admin/credentials';

beforeEach(() => {
  installFakeGas({ PASSWORD_ITERATIONS: '50' });
  seed('Users', [{ userId: 'usr-cg', role: 'CG', enabled: 'true' }]);
});

describe('setDemoCredential', () => {
  it('stores a salted hash that password sign-in accepts, and replaces the previous credential', () => {
    setDemoCredential('usr-cg', 'CG.Demo', 'first password 123');
    const result = setDemoCredential('usr-cg', 'cg.demo', 'second password 456');
    expect(result).toMatchObject({ userId: 'usr-cg', identifier: 'cg.demo', iterations: 50 });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(records('AuthCredentials').map((row) => row.status)).toEqual(['REVOKED', 'ACTIVE']);
    const signIn = (password: string) => parseOutput(doPost(signedEvent('auth.passwordVerify', 'anonymous', { identifier: 'cg.demo', password })));
    expect(signIn('second password 456')).toMatchObject({ ok: true, data: { userId: 'usr-cg' } });
    expect(signIn('first password 123')).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' });
    expect(JSON.stringify(records('AuthCredentials'))).not.toContain('second password');
  });

  it('refuses outside DEMO, for unknown users and for short passwords', () => {
    expect(() => setDemoCredential('usr-missing', 'x', 'long enough password')).toThrow('USER_NOT_FOUND');
    expect(() => setDemoCredential('usr-cg', 'cg', 'short')).toThrow('PASSWORD_TOO_SHORT');
    installFakeGas({ APP_MODE: 'PILOT' });
    expect(() => setDemoCredential('usr-cg', 'cg', 'long enough password')).toThrow('DEMO_MODE_REQUIRED');
  });
});
