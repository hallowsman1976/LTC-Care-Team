import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';
import { addApprovedRuleset, createPilotCaseManager, renewCaseManagerCredential, resetUserPassword } from '../src/admin/pilotSetup';

const pilot = { APP_MODE: 'PILOT', PASSWORD_AUTH_ENABLED: 'true', PASSWORD_PEPPER: 'p'.repeat(32), PASSWORD_ITERATIONS: '50' };
const nextYear = `${new Date().getFullYear() + 1}-12-31`;
const cm = { username: 'CM.One', displayName: 'พยาบาล หนึ่ง', password: 'a long pilot password', credentialType: 'CM certificate 123', qualificationExpiry: nextYear };
const signIn = (identifier: string, password: string) => parseOutput(doPost(signedEvent('auth.passwordVerify', 'anonymous', { identifier, password })));

beforeEach(() => { installFakeGas(pilot); });

describe('PILOT password sign-in', () => {
  it('creates a CM with a verified credential who can sign in', () => {
    const { userId, username } = createPilotCaseManager(cm);
    expect(username).toBe('cm.one');
    expect(records('StaffProfiles')[0]).toMatchObject({ userId, staffType: 'CM', qualificationExpiry: nextYear });
    expect(signIn('cm.one', cm.password)).toMatchObject({ ok: true, data: { userId, role: 'CM' } });
    expect(JSON.stringify(records('AuthCredentials'))).not.toContain(cm.password);
    expect(records('AuditLogs').at(-1)).toMatchObject({ action: 'pilot.caseManager.create', entityId: userId });
  });

  it('refuses a taken username, an expired credential and a short password', () => {
    createPilotCaseManager(cm);
    expect(() => createPilotCaseManager(cm)).toThrow('USERNAME_TAKEN');
    expect(() => createPilotCaseManager({ ...cm, username: 'cm.two', qualificationExpiry: '2020-01-01' })).toThrow('QUALIFICATION_EXPIRY_INVALID');
    expect(() => createPilotCaseManager({ ...cm, username: 'cm.three', password: 'short' })).toThrow('PASSWORD_TOO_SHORT');
  });

  it('resets a password and renews a credential', () => {
    const { userId } = createPilotCaseManager(cm);
    resetUserPassword('cm.one', 'another long password');
    expect(signIn('cm.one', cm.password)).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' });
    expect(signIn('cm.one', 'another long password')).toMatchObject({ ok: true, data: { userId } });
    const later = `${new Date().getFullYear() + 2}-06-30`;
    renewCaseManagerCredential('cm.one', 'renewed certificate', later);
    expect(records('StaffProfiles')[0]).toMatchObject({ credentialType: 'renewed certificate', qualificationExpiry: later });
  });

  it('records an approved ruleset once', () => {
    addApprovedRuleset({ rulesetId: 'rs-2570', fiscalYear: '2570', policyName: 'ชุดกฎบริการ 2570', validFrom: '2026-10-01', validTo: '2027-09-30', approvedBy: 'ผอ.รพ.สต.' });
    expect(records('ServiceRuleSets')[0]).toMatchObject({ rulesetId: 'rs-2570', status: 'APPROVED' });
    expect(() => addApprovedRuleset({ rulesetId: 'rs-2570', fiscalYear: '2570', policyName: 'x', validFrom: '2026-10-01', validTo: '2027-09-30', approvedBy: 'y' })).toThrow('RULESET_EXISTS');
  });

  it('keeps password sign-in closed in PILOT unless it is enabled', () => {
    installFakeGas({ ...pilot, PASSWORD_AUTH_ENABLED: 'false' });
    seed('Users', [{ userId: 'usr-cm', role: 'CM', enabled: 'true' }]);
    expect(signIn('cm.one', cm.password)).toMatchObject({ ok: false, code: 'PASSWORD_AUTH_DISABLED' });
    expect(() => createPilotCaseManager(cm)).toThrow('PASSWORD_AUTH_DISABLED');
  });

  it('refuses a weak pepper in PILOT', () => {
    installFakeGas({ ...pilot, PASSWORD_PEPPER: 'short' });
    expect(signIn('cm.one', cm.password)).toMatchObject({ ok: false });
  });

  it('only runs in PILOT', () => {
    installFakeGas({ PASSWORD_ITERATIONS: '50' });
    expect(() => createPilotCaseManager(cm)).toThrow('PILOT_MODE_REQUIRED');
  });
});
