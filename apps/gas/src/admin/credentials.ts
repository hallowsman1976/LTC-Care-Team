import { getAppMode, getRequiredProperty } from '../config';
import { appendUnique, getById, updateWhere, withScriptLock } from '../repositories/sheets';
import { derivePasswordHash } from '../security/password';
import { audit } from '../security/audit';

const DEFAULT_ITERATIONS = 10_000;

function randomSaltBase64(): string {
  // Apps Script has no CSPRNG API; two v4 UUIDs (244 random bits) hashed give a unique 32-byte salt.
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${Utilities.getUuid()}${Utilities.getUuid()}`, Utilities.Charset.UTF_8));
}

/**
 * Run from the Apps Script editor to give a demo user a password. DEMO only. Revokes the user's
 * previous credential and any credential that held the same identifier (for example after a
 * userId was renamed in Users), so the identifier always signs in as `userId`. Returns how long
 * one hash took, so PASSWORD_ITERATIONS can be tuned to keep sign-in under ~5 seconds.
 */
export function setDemoCredential(userId: string, identifier: string, password: string): { userId: string; identifier: string; iterations: number; elapsedMs: number; revokedCredentials: number } {
  if (getAppMode() !== 'DEMO') throw new Error('DEMO_MODE_REQUIRED');
  if (!getById('Users', 'userId', userId)) throw new Error('USER_NOT_FOUND');
  const result = storePasswordCredential(userId, identifier, password);
  audit('editor', 'credential.set', 'User', userId, 'SUCCESS', `DEMO_PASSWORD;REVOKED:${result.revokedCredentials}`);
  return result;
}

/** Hashes and stores a password, revoking earlier credentials for the user or the identifier. */
export function storePasswordCredential(userId: string, identifier: string, password: string): { userId: string; identifier: string; iterations: number; elapsedMs: number; revokedCredentials: number } {
  if (password.length < 12 || password.length > 200) throw new Error('PASSWORD_TOO_SHORT');
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) throw new Error('IDENTIFIER_REQUIRED');
  const iterations = Number(PropertiesService.getScriptProperties().getProperty('PASSWORD_ITERATIONS') ?? DEFAULT_ITERATIONS);
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('INVALID_CONFIG:PASSWORD_ITERATIONS');
  const saltBase64 = randomSaltBase64();
  const started = Date.now();
  const derivedHashBase64 = derivePasswordHash(password, saltBase64, getRequiredProperty('PASSWORD_PEPPER'), iterations);
  const elapsedMs = Date.now() - started;
  const revokedCredentials = withScriptLock(() => {
    const revoked = updateWhere('AuthCredentials', (row) => String(row.status) === 'ACTIVE'
      && (String(row.userId) === userId || String(row.identifierNormalized).toLowerCase() === normalized), { status: 'REVOKED' });
    appendUnique('AuthCredentials', 'credentialId', {
      credentialId: Utilities.getUuid(), userId, identifierNormalized: normalized, saltBase64, derivedHashBase64,
      algorithm: 'PBKDF2-HMAC-SHA256+pepper', iterations, passwordChangedAt: new Date().toISOString(), status: 'ACTIVE'
    });
    return revoked;
  });
  return { userId, identifier: normalized, iterations, elapsedMs, revokedCredentials };
}
