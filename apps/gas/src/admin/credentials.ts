import { getAppMode, getRequiredProperty } from '../config';
import { appendUnique, getById, listPage, updateWhere, withScriptLock } from '../repositories/sheets';
import { derivePasswordHash } from '../security/password';
import { audit } from '../security/audit';

const DEFAULT_ITERATIONS = 10_000;

function randomSaltBase64(): string {
  // Apps Script has no CSPRNG API; two v4 UUIDs (244 random bits) hashed give a unique 32-byte salt.
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${Utilities.getUuid()}${Utilities.getUuid()}`, Utilities.Charset.UTF_8));
}

/**
 * Run from the Apps Script editor to give a demo user a password. DEMO only. Replaces any previous
 * credential for the user. Returns how long one hash took, so PASSWORD_ITERATIONS can be tuned to
 * keep sign-in under ~5 seconds.
 */
export function setDemoCredential(userId: string, identifier: string, password: string): { userId: string; identifier: string; iterations: number; elapsedMs: number } {
  if (getAppMode() !== 'DEMO') throw new Error('DEMO_MODE_REQUIRED');
  if (!getById('Users', 'userId', userId)) throw new Error('USER_NOT_FOUND');
  if (password.length < 12 || password.length > 200) throw new Error('PASSWORD_TOO_SHORT');
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) throw new Error('IDENTIFIER_REQUIRED');
  const iterations = Number(PropertiesService.getScriptProperties().getProperty('PASSWORD_ITERATIONS') ?? DEFAULT_ITERATIONS);
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('INVALID_CONFIG:PASSWORD_ITERATIONS');
  const saltBase64 = randomSaltBase64();
  const started = Date.now();
  const derivedHashBase64 = derivePasswordHash(password, saltBase64, getRequiredProperty('PASSWORD_PEPPER'), iterations);
  const elapsedMs = Date.now() - started;
  withScriptLock(() => {
    const taken = listPage('AuthCredentials', (row) => String(row.identifierNormalized) === normalized && String(row.status) === 'ACTIVE' && String(row.userId) !== userId, 1);
    if (taken.length) throw new Error('IDENTIFIER_IN_USE');
    updateWhere('AuthCredentials', (row) => String(row.userId) === userId && String(row.status) === 'ACTIVE', { status: 'REVOKED' });
    appendUnique('AuthCredentials', 'credentialId', {
      credentialId: Utilities.getUuid(), userId, identifierNormalized: normalized, saltBase64, derivedHashBase64,
      algorithm: 'PBKDF2-HMAC-SHA256+pepper', iterations, passwordChangedAt: new Date().toISOString(), status: 'ACTIVE'
    });
  });
  audit('editor', 'credential.set', 'User', userId, 'SUCCESS', 'DEMO_PASSWORD');
  return { userId, identifier: normalized, iterations, elapsedMs };
}
