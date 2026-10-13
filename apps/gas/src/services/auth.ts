import type { Actor } from '@smart-ltc/shared';
import { getRequiredProperty } from '../config';
import { listPage } from '../repositories/sheets';
import { derivePasswordHash } from '../security/password';
import { constantTimeEqual } from '../utils/encoding';
import { resolveActorBySubject, resolveActorByUserId } from '../security/rbac';

export function verifyPassword(payload: Record<string, unknown>): Actor {
  const identifier = String(payload.identifier ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  if (!identifier || password.length < 12 || password.length > 200) throw new Error('INVALID_CREDENTIALS');
  const credential = listPage('AuthCredentials', (row) => String(row.identifierNormalized).toLowerCase() === identifier && String(row.status) === 'ACTIVE', 1)[0];
  if (!credential) throw new Error('INVALID_CREDENTIALS');
  const actual = derivePasswordHash(password, String(credential.saltBase64), getRequiredProperty('PASSWORD_PEPPER'), Number(credential.iterations));
  if (!constantTimeEqual(actual, String(credential.derivedHashBase64))) throw new Error('INVALID_CREDENTIALS');
  try {
    // Same enabled/role/clinical-credential rules as Google sign-in.
    return resolveActorByUserId(String(credential.userId));
  } catch (error) {
    // A disabled account is indistinguishable from a wrong password; an expired CM credential is not.
    if (error instanceof Error && error.message === 'ACTOR_NOT_ALLOWED') throw new Error('INVALID_CREDENTIALS');
    throw error;
  }
}

export function resolveIdentity(payload: Record<string, unknown>): Actor {
  return resolveActorBySubject(String(payload.subject ?? ''));
}
