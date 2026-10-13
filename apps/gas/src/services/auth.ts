import type { Actor, Role } from '@smart-ltc/shared';
import { getRequiredProperty } from '../config';
import { listPage } from '../repositories/sheets';
import { derivePasswordHash } from '../security/password';
import { constantTimeEqual } from '../utils/encoding';
import { resolveActor } from '../security/rbac';

const capabilities: Record<Role, Actor['capabilities']> = {
  ADMIN: ['users:manage', 'export:phi'],
  CM: ['patients:read', 'patients:write', 'adl:approve', 'classification:confirm', 'carePlan:approve', 'encounter:review', 'export:phi'],
  CG: ['patients:read']
};

export function verifyPassword(payload: Record<string, unknown>): Actor {
  const identifier = String(payload.identifier ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  if (!identifier || password.length < 12 || password.length > 200) throw new Error('INVALID_CREDENTIALS');
  const credential = listPage('AuthCredentials', (row) => String(row.identifierNormalized).toLowerCase() === identifier && String(row.status) === 'ACTIVE', 1)[0];
  if (!credential) throw new Error('INVALID_CREDENTIALS');
  const actual = derivePasswordHash(password, String(credential.saltBase64), getRequiredProperty('PASSWORD_PEPPER'), Number(credential.iterations));
  if (!constantTimeEqual(actual, String(credential.derivedHashBase64))) throw new Error('INVALID_CREDENTIALS');
  const user = listPage('Users', (row) => String(row.userId) === String(credential.userId) && String(row.enabled).toLowerCase() === 'true', 1)[0];
  if (!user) throw new Error('INVALID_CREDENTIALS');
  const role = String(user.role) as Role;
  return { userId: String(user.userId), role, capabilities: capabilities[role] ?? [] };
}

export function resolveIdentity(payload: Record<string, unknown>): Actor {
  return resolveActor(String(payload.subject ?? ''));
}
