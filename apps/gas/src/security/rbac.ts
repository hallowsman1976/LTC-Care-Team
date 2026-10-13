import type { Actor, Capability, Role } from '@smart-ltc/shared';
import { getSpreadsheet } from '../config';
import { listPage } from '../repositories/sheets';

const roleCapabilities: Record<Role, Capability[]> = {
  ADMIN: ['users:manage', 'export:phi'],
  CM: ['patients:read', 'patients:write', 'adl:approve', 'classification:confirm', 'carePlan:approve', 'encounter:review', 'export:phi'],
  CG: ['patients:read']
};

export function resolveActor(identitySubject: string): Actor {
  const sheet = getSpreadsheet().getSheetByName('Users');
  if (!sheet) throw new Error('USERS_SHEET_MISSING');
  const values = sheet.getDataRange().getValues();
  const headers = values[0]?.map(String) ?? [];
  const subjectIndex = headers.indexOf('identitySubject');
  const enabledIndex = headers.indexOf('enabled');
  const roleIndex = headers.indexOf('role');
  const userIdIndex = headers.indexOf('userId');
  const row = values.slice(1).find((candidate) => String(candidate[subjectIndex]) === identitySubject);
  if (!row || String(row[enabledIndex]).toLowerCase() !== 'true') throw new Error('ACTOR_NOT_ALLOWED');
  const role = String(row[roleIndex]) as Role;
  if (!roleCapabilities[role]) throw new Error('INVALID_ROLE');
  const userId = String(row[userIdIndex]);
  if (role === 'CM') {
    const profile = listPage('StaffProfiles', (candidate) => String(candidate.userId) === userId, 1)[0];
    const expiry = String(profile?.qualificationExpiry ?? '');
    if (!profile?.credentialVerifiedAt || !expiry || new Date(expiry).valueOf() <= Date.now()) throw new Error('CLINICAL_CREDENTIAL_INVALID');
    return { userId, role, capabilities: roleCapabilities[role], credentialValidUntil: new Date(expiry).toISOString() };
  }
  return { userId, role, capabilities: roleCapabilities[role] };
}

export function requireCapability(actor: Actor, capability: Capability): void {
  if (!actor.capabilities.includes(capability)) throw new Error('FORBIDDEN');
}

