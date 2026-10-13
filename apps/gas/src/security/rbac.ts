import { capabilitiesFor, type Actor, type Capability, type Role } from '@smart-ltc/shared';
import { listPage, type RowRecord } from '../repositories/sheets';

function actorFromUserRow(row: RowRecord | undefined): Actor {
  if (!row || String(row.enabled).toLowerCase() !== 'true') throw new Error('ACTOR_NOT_ALLOWED');
  const role = String(row.role) as Role;
  const capabilities = capabilitiesFor(role);
  const userId = String(row.userId);
  if (role === 'CM') {
    const profile = listPage('StaffProfiles', (candidate) => String(candidate.userId) === userId, 1)[0];
    const expiry = String(profile?.qualificationExpiry ?? '');
    if (!profile?.credentialVerifiedAt || !expiry || new Date(expiry).valueOf() <= Date.now()) throw new Error('CLINICAL_CREDENTIAL_INVALID');
    return { userId, role, capabilities, credentialValidUntil: new Date(expiry).toISOString() };
  }
  return { userId, role, capabilities };
}

/** For gateway requests after login: the session carries our own userId. */
export function resolveActorByUserId(userId: string): Actor {
  return actorFromUserRow(listPage('Users', (row) => String(row.userId) === userId, 1)[0]);
}

/** For sign-in only: maps an identity-provider subject (Google `sub`) to a user. */
export function resolveActorBySubject(identitySubject: string): Actor {
  if (!identitySubject) throw new Error('ACTOR_NOT_ALLOWED');
  return actorFromUserRow(listPage('Users', (row) => String(row.identitySubject) === identitySubject, 1)[0]);
}

export function requireCapability(actor: Actor, capability: Capability): void {
  if (!actor.capabilities.includes(capability)) throw new Error('FORBIDDEN');
}
