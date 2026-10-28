import { getAppMode, isPasswordAuthEnabled } from '../config';
import { appendUnique, getById, listAll, updateWhere, withScriptLock } from '../repositories/sheets';
import { audit } from '../security/audit';
import { storePasswordCredential } from './credentials';

// Editor-only setup for a PILOT that signs in with passwords (no Google Workspace). Only people
// with edit access to the Apps Script project can run these; every run is written to AuditLogs.
// Put calls in a temporary editor file and delete it afterwards: it holds a password.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const USERNAME = /^[a-z0-9._-]{3,40}$/;

function requirePilotPasswordAuth(): void {
  if (getAppMode() !== 'PILOT') throw new Error('PILOT_MODE_REQUIRED');
  if (!isPasswordAuthEnabled()) throw new Error('PASSWORD_AUTH_DISABLED');
}

export interface CaseManagerInput {
  username: string;
  displayName: string;
  password: string;
  /** What was checked, e.g. "ใบประกาศนียบัตร CM เลขที่ ..." */
  credentialType: string;
  /** yyyy-MM-dd; the account stops working after this day until it is renewed. */
  qualificationExpiry: string;
  email?: string;
}

function normalizedNewUsername(raw: string): string {
  const username = String(raw ?? '').trim().toLowerCase();
  if (!USERNAME.test(username)) throw new Error('INVALID_USERNAME');
  return username;
}

function requireDisplayName(raw: string): string {
  const displayName = String(raw ?? '').trim();
  if (!displayName) throw new Error('DISPLAY_NAME_REQUIRED');
  return displayName;
}

/** Call inside the script lock, before writing the new user. */
function requireFreeUsername(username: string): void {
  const taken = listAll('Users', (row) => String(row.usernameNormalized).toLowerCase() === username).length > 0
    || listAll('AuthCredentials', (row) => String(row.status) === 'ACTIVE' && String(row.identifierNormalized).toLowerCase() === username).length > 0;
  if (taken) throw new Error('USERNAME_TAKEN');
}

/**
 * Creates a CM who can sign in with a password, with the clinical credential the person running
 * this has verified today. The CM sets up their authenticator app at first sign-in.
 */
export function createPilotCaseManager(input: CaseManagerInput): { userId: string; username: string } {
  requirePilotPasswordAuth();
  const username = normalizedNewUsername(input.username);
  const displayName = requireDisplayName(input.displayName);
  if (!String(input.credentialType ?? '').trim()) throw new Error('CREDENTIAL_TYPE_REQUIRED');
  if (!DATE.test(input.qualificationExpiry) || new Date(input.qualificationExpiry).valueOf() <= Date.now()) throw new Error('QUALIFICATION_EXPIRY_INVALID');
  const userId = `usr-${Utilities.getUuid()}`;
  const now = new Date().toISOString();
  withScriptLock(() => {
    requireFreeUsername(username);
    appendUnique('Users', 'userId', { userId, identitySubject: '', email: input.email ?? '', usernameNormalized: username, displayName, role: 'CM', enabled: 'true', createdAt: now, updatedAt: now });
    appendUnique('StaffProfiles', 'staffId', { staffId: `stf-${Utilities.getUuid()}`, userId, staffType: 'CM', credentialType: input.credentialType.trim(), credentialVerifiedAt: now.slice(0, 10), qualificationExpiry: input.qualificationExpiry });
    storePasswordCredential(userId, username, input.password);
  });
  audit('editor', 'pilot.caseManager.create', 'User', userId, 'SUCCESS');
  return { userId, username };
}

export interface AdminInput {
  username: string;
  displayName: string;
  password: string;
  email?: string;
}

/**
 * Creates a system administrator (ADMIN role: users, assignments, patient import, PHI export,
 * budget read) who signs in with a password and sets up their authenticator app at first sign-in.
 * ADMIN has no clinical credential, so there is no staff profile to verify or renew.
 */
export function createPilotAdmin(input: AdminInput): { userId: string; username: string } {
  requirePilotPasswordAuth();
  const username = normalizedNewUsername(input.username);
  const displayName = requireDisplayName(input.displayName);
  const userId = `usr-${Utilities.getUuid()}`;
  const now = new Date().toISOString();
  withScriptLock(() => {
    requireFreeUsername(username);
    appendUnique('Users', 'userId', { userId, identitySubject: '', email: input.email ?? '', usernameNormalized: username, displayName, role: 'ADMIN', enabled: 'true', createdAt: now, updatedAt: now });
    storePasswordCredential(userId, username, input.password);
  });
  audit('editor', 'pilot.admin.create', 'User', userId, 'SUCCESS');
  return { userId, username };
}

/** Renews a CM's verified credential, e.g. after the certificate was renewed. */
export function renewCaseManagerCredential(username: string, credentialType: string, qualificationExpiry: string): { userId: string } {
  requirePilotPasswordAuth();
  if (!DATE.test(qualificationExpiry) || new Date(qualificationExpiry).valueOf() <= Date.now()) throw new Error('QUALIFICATION_EXPIRY_INVALID');
  const user = listAll('Users', (row) => String(row.usernameNormalized).toLowerCase() === username.trim().toLowerCase() && String(row.role) === 'CM')[0];
  if (!user) throw new Error('USER_NOT_FOUND');
  const userId = String(user.userId);
  const changed = withScriptLock(() => updateWhere('StaffProfiles', (row) => String(row.userId) === userId,
    { credentialType: credentialType.trim(), credentialVerifiedAt: new Date().toISOString().slice(0, 10), qualificationExpiry }));
  if (!changed) throw new Error('STAFF_PROFILE_NOT_FOUND');
  audit('editor', 'pilot.caseManager.renew', 'User', userId, 'SUCCESS');
  return { userId };
}

/**
 * Sets a new password for any user (a CM who forgot theirs; caregivers can also be reset from
 * the caregiver edit screen). Their authenticator app keeps working.
 */
export function resetUserPassword(username: string, newPassword: string): { userId: string } {
  requirePilotPasswordAuth();
  const normalized = username.trim().toLowerCase();
  const credential = listAll('AuthCredentials', (row) => String(row.status) === 'ACTIVE' && String(row.identifierNormalized).toLowerCase() === normalized)[0];
  const userId = String(credential?.userId ?? listAll('Users', (row) => String(row.usernameNormalized).toLowerCase() === normalized)[0]?.userId ?? '');
  if (!userId || !getById('Users', 'userId', userId)) throw new Error('USER_NOT_FOUND');
  storePasswordCredential(userId, normalized, newPassword);
  audit('editor', 'pilot.password.reset', 'User', userId, 'SUCCESS');
  return { userId };
}

export interface RulesetInput {
  rulesetId: string;
  fiscalYear: string;
  policyName: string;
  sourceUrl?: string;
  validFrom: string;
  validTo: string;
  /** Name or position of whoever approved it under clinical governance. */
  approvedBy: string;
}

/** Records a service ruleset that clinical governance has approved, so CMs can build care plans on it. */
export function addApprovedRuleset(input: RulesetInput): { rulesetId: string } {
  requirePilotPasswordAuth();
  const rulesetId = String(input.rulesetId ?? '').trim();
  if (!/^[\w.-]{3,40}$/.test(rulesetId)) throw new Error('INVALID_RULESET_ID');
  if (!DATE.test(input.validFrom) || !DATE.test(input.validTo) || input.validTo < input.validFrom) throw new Error('INVALID_VALIDITY');
  if (!String(input.policyName ?? '').trim() || !String(input.approvedBy ?? '').trim()) throw new Error('POLICY_AND_APPROVER_REQUIRED');
  withScriptLock(() => {
    if (getById('ServiceRuleSets', 'rulesetId', rulesetId)) throw new Error('RULESET_EXISTS');
    appendUnique('ServiceRuleSets', 'rulesetId', {
      rulesetId, fiscalYear: input.fiscalYear, policyName: input.policyName.trim(), sourceUrl: input.sourceUrl ?? '',
      validFrom: input.validFrom, validTo: input.validTo, status: 'APPROVED', approvedBy: input.approvedBy.trim(), approvedAt: new Date().toISOString()
    });
  });
  audit('editor', 'pilot.ruleset.add', 'ServiceRuleSet', rulesetId, 'SUCCESS');
  return { rulesetId };
}
