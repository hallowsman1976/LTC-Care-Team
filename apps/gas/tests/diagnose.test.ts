import { beforeEach, describe, expect, it } from 'vitest';
import { fakeGas, installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';
import { appendUnique, bulkAppend, getSheet, updateWhere, versionedUpdate } from '../src/repositories/sheets';
import { setDemoCredential } from '../src/admin/credentials';
import { verifyPassword } from '../src/services/auth';
import { diagnoseDemoLogin } from '../src/admin/diagnose';
import { SHEETS } from '../src/initializer';

beforeEach(() => {
  installFakeGas({ PASSWORD_ITERATIONS: '5' });
  seed('Users', [{ userId: 'usr-cg', role: 'CG', enabled: 'true' }, { userId: 'usr-cm', role: 'CM', enabled: 'true' }]);
});

describe('text that looks like a formula', () => {
  const tricky = ['=IMPORTXML("https://evil.example","//a")', '+abc/def==', '-not a number', '@mention'];

  it('is stored as text by every writer', () => {
    tricky.forEach((fullName, index) => appendUnique('Patients', 'patientId', { patientId: `pt-${index}`, fullName, recordVersion: 1 }));
    expect(records('Patients').map((row) => row.fullName)).toEqual(tricky);
    bulkAppend(getSheet('Alerts'), SHEETS.Alerts!, [{ alertId: 'al-1', alertType: tricky[0] }]);
    expect(records('Alerts')[0]!.alertType).toBe(tricky[0]);
    versionedUpdate('Patients', 'patientId', 'pt-0', 1, { address: tricky[1] });
    updateWhere('Patients', (row) => row.patientId === 'pt-1', { village: tricky[2] });
    expect(records('Patients')[0]!.address).toBe(tricky[1]);
    expect(records('Patients')[1]!.village).toBe(tricky[2]);
  });

  it('keeps numbers, booleans and dates as they are', () => {
    appendUnique('Patients', 'patientId', { patientId: 'pt-x', recordVersion: 1, fullName: 'ปกติ', phone: '-' });
    expect(records('Patients')[0]).toMatchObject({ recordVersion: 1, fullName: 'ปกติ', phone: '-' });
  });

  it('cannot corrupt a stored password hash', () => {
    const encode = (globalThis as unknown as { Utilities: { base64Encode: (value: unknown) => string } }).Utilities;
    const original = encode.base64Encode;
    encode.base64Encode = (value) => `+${original(value)}`; // force the unlucky leading '+'
    try {
      setDemoCredential('usr-cg', 'cg.demo', 'correct horse battery');
      const [stored] = records('AuthCredentials');
      expect(String(stored!.saltBase64)).toMatch(/^\+/);
      expect(String(stored!.derivedHashBase64)).toMatch(/^\+/);
      // Called directly: the patched encoder would also break the gateway signature check in doPost.
      expect(verifyPassword({ identifier: 'cg.demo', password: 'correct horse battery' })).toMatchObject({ userId: 'usr-cg' });
    } finally {
      encode.base64Encode = original;
    }
  });
});

describe('diagnoseDemoLogin', () => {
  const failed = (identifier: string, password?: string) => diagnoseDemoLogin(identifier, password).verdict;

  it('reports a working account', () => {
    setDemoCredential('usr-cg', 'cg.demo', 'correct horse battery');
    const result = diagnoseDemoLogin('CG.Demo', 'correct horse battery');
    expect(result.verdict).toBe('OK');
    const [stored] = records('AuthCredentials');
    const output = JSON.stringify(result);
    for (const secret of ['correct horse battery', String(stored!.saltBase64), String(stored!.derivedHashBase64), 'pepper']) expect(output).not.toContain(secret);
  });

  it('names the first step that fails', () => {
    expect(failed('nobody')).toBe('NO_ACTIVE_CREDENTIAL');
    setDemoCredential('usr-cg', 'cg.demo', 'correct horse battery');
    expect(failed('cg.demo', 'wrong password here')).toBe('PASSWORD_MISMATCH');
    expect(failed('cg.demo')).toBe('OK'); // without a password the hash is not checked
    fakeGas.sheets.get('Users')!.rows[1]![SHEETS.Users!.indexOf('enabled')] = 'FALSE';
    expect(failed('cg.demo')).toBe('USER_NOT_ENABLED');
    fakeGas.sheets.get('Users')!.rows[1]![SHEETS.Users!.indexOf('userId')] = 'usr-cg-typo';
    expect(failed('cg.demo')).toBe('USER_ROW_NOT_FOUND');
  });

  it('detects a hash broken by formula parsing and a CM without a valid clinical credential', () => {
    setDemoCredential('usr-cm', 'cm.demo', 'correct horse battery');
    expect(failed('cm.demo')).toBe('CM_CLINICAL_CREDENTIAL_INVALID');
    const credentials = fakeGas.sheets.get('AuthCredentials')!;
    credentials.rows[1]![SHEETS.AuthCredentials!.indexOf('derivedHashBase64')] = '#ERROR!';
    expect(failed('cm.demo')).toBe('STORED_HASH_CORRUPTED');
  });

  it('refuses outside DEMO', () => {
    installFakeGas({ APP_MODE: 'PILOT', GATEWAY_ASSERTION_SECRET: 'p'.repeat(32) });
    expect(() => diagnoseDemoLogin('cg.demo')).toThrow('DEMO_MODE_REQUIRED');
  });
});
