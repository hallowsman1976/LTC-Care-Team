import { z } from 'zod';
import { assignmentSetSchema, caregiverCreateSchema, MAX_IMPORT_ROWS_PER_REQUEST, patientImportRowSchema, patientImportSchema, type Actor, type Page } from '@smart-ltc/shared';
import { getAppMode } from '../config';
import { appendUnique, bulkAppend, getById, getSheet, headersOf, listAll, updateWhere, withScriptLock, type RowRecord } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';
import { storePasswordCredential } from '../admin/credentials';

const bangkokToday = () => Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
const isActiveCgAssignment = (row: RowRecord) => String(row.status) === 'ACTIVE' && String(row.role) === 'CG';

export function listCaregivers(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'users:manage');
  const assignments = listAll('StaffAssignments', isActiveCgAssignment);
  const items = listAll('Users', (row) => String(row.role) === 'CG').map((row) => ({
    userId: row.userId, displayName: row.displayName, username: row.usernameNormalized,
    enabled: String(row.enabled).toLowerCase() === 'true',
    activePatients: assignments.filter((assignment) => String(assignment.staffId) === String(row.userId)).length
  }));
  return { items, hasMore: false };
}

/** A caregiver account that signs in with username and password (DEMO sign-in). */
export function createCaregiver(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'users:manage');
  if (getAppMode() !== 'DEMO') throw new Error('PASSWORD_AUTH_DISABLED');
  const input = caregiverCreateSchema.parse(payload);
  const userId = `usr-${Utilities.getUuid()}`;
  const now = new Date().toISOString();
  withScriptLock(() => {
    const taken = listAll('Users', (row) => String(row.usernameNormalized).toLowerCase() === input.username).length > 0
      || listAll('AuthCredentials', (row) => String(row.status) === 'ACTIVE' && String(row.identifierNormalized).toLowerCase() === input.username).length > 0;
    if (taken) throw new Error('USERNAME_TAKEN');
    appendUnique('Users', 'userId', { userId, identitySubject: '', email: '', usernameNormalized: input.username, displayName: input.displayName, role: 'CG', enabled: 'true', createdAt: now, updatedAt: now });
    appendUnique('StaffProfiles', 'staffId', { staffId: `stf-${Utilities.getUuid()}`, userId, staffType: 'CG', credentialType: '', credentialVerifiedAt: '', qualificationExpiry: '' });
    storePasswordCredential(userId, input.username, input.password);
  });
  audit(actor.userId, 'caregiver.create', 'User', userId, 'SUCCESS');
  return { userId, displayName: input.displayName, username: input.username };
}

/** Every active patient with the caregiver currently assigned, for the admin assignment screen. */
export function listAssignments(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'assignments:manage');
  const episodes = listAll('CareEpisodes', (row) => String(row.status) === 'ACTIVE');
  const episodeOfPatient = new Map(episodes.map((row) => [String(row.patientId), String(row.episodeId)]));
  const caregiverOfEpisode = new Map(listAll('StaffAssignments', isActiveCgAssignment).map((row) => [String(row.episodeId), String(row.staffId)]));
  const nameOfUser = new Map(listAll('Users', (row) => String(row.role) === 'CG').map((row) => [String(row.userId), String(row.displayName)]));
  const items = listAll('Patients', (row) => String(row.status) === 'ACTIVE').map((row) => {
    const episodeId = episodeOfPatient.get(String(row.patientId));
    const caregiverUserId = episodeId ? caregiverOfEpisode.get(episodeId) ?? '' : '';
    return {
      patientId: row.patientId, localCode: row.localCode, hn: row.hn, fullName: row.fullName, village: row.village,
      hasActiveEpisode: Boolean(episodeId), caregiverUserId, caregiverName: caregiverUserId ? nameOfUser.get(caregiverUserId) ?? caregiverUserId : ''
    };
  });
  return { items, hasMore: false };
}

/**
 * Makes `caregiverUserId` the patient's caregiver: ends the previous CG assignment and moves the
 * patient's upcoming, not yet started visits to the new caregiver. Opens a care episode when the
 * patient has none, so newly registered or imported patients can be assigned straight away.
 */
export function setAssignment(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'assignments:manage');
  const input = assignmentSetSchema.parse(payload);
  const patient = getById('Patients', 'patientId', input.patientId);
  if (!patient || String(patient.status) !== 'ACTIVE') throw new Error('PATIENT_NOT_FOUND');
  const caregiver = getById('Users', 'userId', input.caregiverUserId);
  if (!caregiver || String(caregiver.role) !== 'CG' || String(caregiver.enabled).toLowerCase() !== 'true') throw new Error('CAREGIVER_NOT_FOUND');
  const today = bangkokToday();
  const now = new Date().toISOString();
  const result = withScriptLock(() => {
    const active = listAll('CareEpisodes', (row) => String(row.patientId) === input.patientId && String(row.status) === 'ACTIVE');
    if (active.length > 1) throw new Error('MULTIPLE_ACTIVE_EPISODES');
    let episodeId = String(active[0]?.episodeId ?? '');
    if (!episodeId) {
      episodeId = Utilities.getUuid();
      const consent = listAll('PatientConsents', (row) => String(row.patientId) === input.patientId && !String(row.revokedAt))
        .sort((left, right) => String(right.givenAt).localeCompare(String(left.givenAt)))[0];
      appendUnique('CareEpisodes', 'episodeId', { episodeId, patientId: input.patientId, startDate: today, endDate: '', eligibilityStatus: 'PENDING_ASSESSMENT', status: 'ACTIVE', fundingType: 'LTC', legalBasis: String(consent?.legalBasis ?? '') });
    }
    const current = listAll('StaffAssignments', (row) => String(row.episodeId) === episodeId && isActiveCgAssignment(row));
    if (current.length === 1 && String(current[0]!.staffId) === input.caregiverUserId) return { episodeId, status: 'UNCHANGED', reassignedVisits: 0 };
    updateWhere('StaffAssignments', (row) => String(row.episodeId) === episodeId && isActiveCgAssignment(row), { status: 'ENDED', dateTo: today });
    appendUnique('StaffAssignments', 'assignmentId', { assignmentId: Utilities.getUuid(), episodeId, staffId: input.caregiverUserId, role: 'CG', dateFrom: today, dateTo: '', status: 'ACTIVE', assignedBy: actor.userId });
    const reassignedVisits = updateWhere('VisitSchedules', (row) => String(row.episodeId) === episodeId
      && ['PLANNED', 'ASSIGNED'].includes(String(row.status)) && String(row.visitDateTime).slice(0, 10) >= today, { assignedStaffId: input.caregiverUserId });
    return { episodeId, status: 'ASSIGNED', reassignedVisits };
  });
  audit(actor.userId, 'assignment.set', 'CareEpisode', result.episodeId, 'SUCCESS', `CG:${input.caregiverUserId};VISITS:${result.reassignedVisits}`);
  return { patientId: input.patientId, caregiverUserId: input.caregiverUserId, ...result };
}

// The gateway replaces each CID with its ciphertext and lookup hash before forwarding.
const forwardedRowSchema = patientImportRowSchema.omit({ cid: true }).extend({
  cidCiphertext: z.string().min(1).max(500),
  cidLookupHash: z.string().min(1).max(200)
});
const forwardedImportSchema = patientImportSchema.omit({ rows: true }).extend({
  rows: z.array(forwardedRowSchema).min(1).max(MAX_IMPORT_ROWS_PER_REQUEST)
});

type SkipReason = 'DUPLICATE_HN' | 'DUPLICATE_CID' | 'POTENTIAL_DUPLICATE';

/**
 * Bulk registration from the unit's register. Each new patient gets an open care episode (pending
 * ADL assessment). Rows that match an existing patient by HN, CID, or name with birth date are
 * skipped and reported, never merged: a CM resolves those one by one.
 */
export function importPatients(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'patients:import');
  const input = forwardedImportSchema.parse(payload);
  const now = new Date().toISOString();
  const today = bangkokToday();
  const outcome = withScriptLock(() => {
    const existing = listAll('Patients', () => true);
    const hns = new Set(existing.map((row) => String(row.hn).toLowerCase()));
    const cids = new Set(existing.map((row) => String(row.cidLookupHash)).filter(Boolean));
    const people = new Set(existing.map((row) => `${String(row.fullName).toLocaleLowerCase('th')}|${String(row.birthDate)}`));
    const patients: RowRecord[] = [];
    const episodes: RowRecord[] = [];
    const consents: RowRecord[] = [];
    const skipped: Array<{ line: number; hn: string; reason: SkipReason }> = [];
    for (const row of input.rows) {
      const person = `${row.fullName.toLocaleLowerCase('th')}|${row.birthDate}`;
      const reason: SkipReason | null = hns.has(row.hn.toLowerCase()) ? 'DUPLICATE_HN' : cids.has(row.cidLookupHash) ? 'DUPLICATE_CID' : people.has(person) ? 'POTENTIAL_DUPLICATE' : null;
      if (reason) { skipped.push({ line: row.line, hn: row.hn, reason }); continue; }
      hns.add(row.hn.toLowerCase()); cids.add(row.cidLookupHash); people.add(person);
      const patientId = Utilities.getUuid();
      patients.push({
        patientId, localCode: row.localCode, hn: row.hn, cidCiphertext: row.cidCiphertext, cidLookupHash: row.cidLookupHash,
        fullName: row.fullName, birthDate: row.birthDate, sex: row.sex, address: row.address, village: row.village, phone: row.phone ?? '',
        status: 'ACTIVE', createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
      });
      episodes.push({ episodeId: Utilities.getUuid(), patientId, startDate: today, endDate: '', eligibilityStatus: 'PENDING_ASSESSMENT', status: 'ACTIVE', fundingType: 'LTC', legalBasis: input.legalBasis ?? '' });
      if (input.legalBasis) {
        consents.push({ consentId: Utilities.getUuid(), patientId, purpose: `LTC_CARE:${input.privacyNoticeVersion || 'UNSPECIFIED'}`, legalBasis: input.legalBasis, givenBy: actor.userId, evidenceFileId: '', givenAt: now, revokedAt: '' });
      }
    }
    for (const [name, records] of [['Patients', patients], ['CareEpisodes', episodes], ['PatientConsents', consents]] as const) {
      const sheet = getSheet(name);
      bulkAppend(sheet, headersOf(sheet), records);
    }
    return { created: patients.length, skipped };
  });
  audit(actor.userId, 'patient.import', 'Patient', '*', 'SUCCESS', `CREATED:${outcome.created};SKIPPED:${outcome.skipped.length}`);
  return outcome;
}
