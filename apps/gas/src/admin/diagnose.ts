import { isPasswordAuthEnabled } from '../config';
import { listAll, listPage } from '../repositories/sheets';
import { derivePasswordHash } from '../security/password';
import { constantTimeEqual } from '../utils/encoding';

type Verdict =
  | 'OK' | 'PASSWORD_PEPPER_MISSING' | 'NO_ACTIVE_CREDENTIAL' | 'STORED_HASH_CORRUPTED' | 'USER_ROW_NOT_FOUND'
  | 'USER_NOT_ENABLED' | 'UNKNOWN_ROLE' | 'CM_CLINICAL_CREDENTIAL_INVALID' | 'PASSWORD_TOO_SHORT' | 'PASSWORD_MISMATCH';

interface Check { step: string; ok: boolean; detail: string }

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Run from the Apps Script editor when a password sign-in (DEMO, or PILOT with PASSWORD_AUTH_ENABLED) fails with "invalid credentials": it walks
 * the same steps as auth.passwordVerify and names the first one that fails. It never returns the
 * salt, hash, pepper or password. Pass the password only from a temporary editor file.
 */
export function diagnoseDemoLogin(identifier: string, password?: string): { identifier: string; verdict: Verdict; checks: Check[] } {
  if (!isPasswordAuthEnabled()) throw new Error('PASSWORD_AUTH_DISABLED');
  const normalized = String(identifier ?? '').trim().toLowerCase();
  const checks: Check[] = [];
  const done = (verdict: Verdict) => {
    const result = { identifier: normalized, verdict, checks };
    console.log(JSON.stringify(result, null, 2));
    return result;
  };

  const pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
  checks.push({ step: 'Script Property PASSWORD_PEPPER is set', ok: Boolean(pepper), detail: '' });
  if (!pepper) return done('PASSWORD_PEPPER_MISSING');

  const forIdentifier = listAll('AuthCredentials', (row) => String(row.identifierNormalized).toLowerCase() === normalized);
  const credential = forIdentifier.find((row) => String(row.status) === 'ACTIVE');
  checks.push({
    step: `AuthCredentials has an ACTIVE row with identifierNormalized "${normalized}"`, ok: Boolean(credential),
    detail: `${forIdentifier.length} row(s) for this identifier; statuses: ${forIdentifier.map((row) => String(row.status)).join(', ') || 'none'}`
  });
  if (!credential) return done('NO_ACTIVE_CREDENTIAL');

  const intact = BASE64.test(String(credential.saltBase64)) && BASE64.test(String(credential.derivedHashBase64)) && Number(credential.iterations) > 0;
  checks.push({ step: 'saltBase64, derivedHashBase64 and iterations are intact (not turned into formulas)', ok: intact, detail: intact ? '' : 'Set the password again (setDemoCredential in DEMO, resetUserPassword in PILOT).' });
  if (!intact) return done('STORED_HASH_CORRUPTED');

  const userId = String(credential.userId);
  const user = listPage('Users', (row) => String(row.userId) === userId, 1)[0];
  checks.push({ step: `Users has a row with userId "${userId}"`, ok: Boolean(user), detail: user ? '' : 'Check the userId spelling in Users and in the credential.' });
  if (!user) return done('USER_ROW_NOT_FOUND');

  const enabled = String(user.enabled).toLowerCase() === 'true';
  checks.push({ step: 'Users.enabled is TRUE', ok: enabled, detail: `value: ${String(user.enabled)}` });
  if (!enabled) return done('USER_NOT_ENABLED');

  const role = String(user.role);
  const knownRole = ['ADMIN', 'CM', 'CG'].includes(role);
  checks.push({ step: 'Users.role is ADMIN, CM or CG', ok: knownRole, detail: `value: ${role}` });
  if (!knownRole) return done('UNKNOWN_ROLE');

  if (role === 'CM') {
    const profile = listPage('StaffProfiles', (row) => String(row.userId) === userId, 1)[0];
    const expiry = new Date(String(profile?.qualificationExpiry ?? '')).valueOf();
    const valid = Boolean(profile?.credentialVerifiedAt) && Number.isFinite(expiry) && expiry > Date.now();
    checks.push({ step: 'CM has StaffProfiles.credentialVerifiedAt and a future qualificationExpiry', ok: valid, detail: profile ? `expiry: ${String(profile.qualificationExpiry)}` : 'no StaffProfiles row' });
    if (!valid) return done('CM_CLINICAL_CREDENTIAL_INVALID');
  }

  if (password === undefined) {
    checks.push({ step: 'Password matches', ok: true, detail: 'not checked (no password given)' });
    return done('OK');
  }
  const longEnough = password.length >= 12 && password.length <= 200;
  checks.push({ step: 'Password is 12 to 200 characters', ok: longEnough, detail: `length: ${password.length}` });
  if (!longEnough) return done('PASSWORD_TOO_SHORT');
  const matches = constantTimeEqual(derivePasswordHash(password, String(credential.saltBase64), pepper, Number(credential.iterations)), String(credential.derivedHashBase64));
  checks.push({ step: 'Password matches', ok: matches, detail: matches ? '' : 'Wrong password, or PASSWORD_PEPPER changed after the password was set.' });
  return done(matches ? 'OK' : 'PASSWORD_MISMATCH');
}
