import { z } from 'zod';
import { villageLabel, assignmentSetSchema, caregiverCreateSchema, caregiverGetSchema, caregiverUpdateSchema, MAX_IMPORT_ROWS_PER_REQUEST, patientImportRowSchema, patientImportSchema, type Actor, type Page } from '@smart-ltc/shared';
import { getAppMode } from '../config';
import { ensureColumns, ensureSheet } from '../initializer';
import { appendUnique, bulkAppend, getById, getSheet, headersOf, listAll, updateWhere, versionedUpdate, withScriptLock, type RowRecord } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';
import { storePasswordCredential } from '../admin/credentials';

const bangkokToday = () => Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
const isActiveCgAssignment = (row: RowRecord) => String(row.status) === 'ACTIVE' && String(row.role) === 'CG';

function trainingsOf(profile: RowRecord | null | undefined): Array<{ course: string; completedOn: string }> {
  try { return JSON.parse(String(profile?.trainingsJson || '[]')) as Array<{ course: string; completedOn: string }>; } catch { return []; }
}

/** Caregivers with a summary of their profile. The CID stays in the sheet, encrypted. */
export function listCaregivers(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'users:manage');
  ensureSheet('CaregiverProfiles');
  const assignments = listAll('StaffAssignments', isActiveCgAssignment);
  const profiles = new Map(listAll('CaregiverProfiles', () => true).map((row) => [String(row.userId), row]));
  const items = listAll('Users', (row) => String(row.role) === 'CG').map((row) => {
    const profile = profiles.get(String(row.userId));
    const trainings = trainingsOf(profile).sort((left, right) => String(right.completedOn).localeCompare(String(left.completedOn)));
    return {
      userId: row.userId, displayName: row.displayName, username: row.usernameNormalized,
      enabled: String(row.enabled).toLowerCase() === 'true',
      activePatients: assignments.filter((assignment) => String(assignment.staffId) === String(row.userId)).length,
      phone: profile?.phone ?? '', organizationName: profile?.organizationName ?? '', education: profile?.education ?? '',
      photoUrl: profile?.photoUrl ?? '', latestTraining: trainings[0]?.course ?? '', trainingCount: trainings.length
    };
  });
  return { items, hasMore: false };
}

const PHOTO_FOLDER_PROPERTY = 'STAFF_PHOTO_FOLDER_ID';

/** Staff photos get their own folder, created on first use, apart from patients' visit photos. */
function staffPhotoFolder(): GoogleAppsScript.Drive.Folder {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty(PHOTO_FOLDER_PROPERTY);
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder('Smart LTC Care – รูปประจำตัวผู้ดูแล');
  properties.setProperty(PHOTO_FOLDER_PROPERTY, folder.getId());
  return folder;
}

/** Every account and its role, for the ข้อมูลผู้ใช้งาน page. Never returns credentials. */
export function listUsers(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'users:manage');
  const expiryOf = new Map(listAll('StaffProfiles', () => true).map((row) => [String(row.userId), String(row.qualificationExpiry ?? '')]));
  const signInNames = new Map(listAll('AuthCredentials', (row) => String(row.status) === 'ACTIVE').map((row) => [String(row.userId), String(row.identifierNormalized)]));
  const roleOrder = ['ADMIN', 'CM', 'CG'];
  const items = listAll('Users', () => true).map((row) => ({
    userId: row.userId, displayName: row.displayName, role: row.role,
    username: signInNames.get(String(row.userId)) || row.usernameNormalized || row.email || '',
    enabled: String(row.enabled).toLowerCase() === 'true', createdAt: row.createdAt,
    credentialValidUntil: String(row.role) === 'CM' ? expiryOf.get(String(row.userId)) ?? '' : ''
  })).sort((left, right) => roleOrder.indexOf(String(left.role)) - roleOrder.indexOf(String(right.role)) || String(left.displayName).localeCompare(String(right.displayName), 'th'));
  return { items, hasMore: false };
}

/** A caregiver account that signs in with username and password (DEMO sign-in). */
export function createCaregiver(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'users:manage');
  if (getAppMode() !== 'DEMO') throw new Error('PASSWORD_AUTH_DISABLED');
  const input = forwardedCaregiverSchema.parse(payload);
  ensureSheet('CaregiverProfiles');
  const userId = `usr-${Utilities.getUuid()}`;
  const now = new Date().toISOString();
  withScriptLock(() => {
    const taken = listAll('Users', (row) => String(row.usernameNormalized).toLowerCase() === input.username).length > 0
      || listAll('AuthCredentials', (row) => String(row.status) === 'ACTIVE' && String(row.identifierNormalized).toLowerCase() === input.username).length > 0;
    if (taken) throw new Error('USERNAME_TAKEN');
    if (listAll('CaregiverProfiles', (row) => String(row.cidLookupHash) === input.cidLookupHash).length) throw new Error('DUPLICATE_STAFF_CID');
    const { photoFileId, photoUrl } = input.photo ? savePhoto(userId, input.photo.base64) : { photoFileId: '', photoUrl: '' };
    appendUnique('Users', 'userId', { userId, identitySubject: '', email: input.email, usernameNormalized: input.username, displayName: input.displayName, role: 'CG', enabled: 'true', createdAt: now, updatedAt: now });
    appendUnique('StaffProfiles', 'staffId', { staffId: `stf-${Utilities.getUuid()}`, userId, staffType: 'CG', credentialType: input.trainings[0]?.course ?? '', credentialVerifiedAt: '', qualificationExpiry: '' });
    appendUnique('CaregiverProfiles', 'userId', {
      userId, cidCiphertext: input.cidCiphertext, cidLookupHash: input.cidLookupHash, birthDate: input.birthDate, phone: input.phone,
      address: input.address, email: input.email, photoFileId, photoUrl, education: input.education,
      organizationName: input.organization.name, organizationType: input.organization.type, serviceArea: input.organization.serviceArea,
      trainingsJson: JSON.stringify(input.trainings), createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
    });
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
/** The patient's active care episode, opened now when there is none. Call inside the script lock. */
export function activeEpisodeFor(patientId: string, legalBasis?: string): string {
  const active = listAll('CareEpisodes', (row) => String(row.patientId) === patientId && String(row.status) === 'ACTIVE');
  if (active.length > 1) throw new Error('MULTIPLE_ACTIVE_EPISODES');
  if (active[0]) return String(active[0].episodeId);
  const consent = legalBasis ? null : listAll('PatientConsents', (row) => String(row.patientId) === patientId && !String(row.revokedAt))
    .sort((left, right) => String(right.givenAt).localeCompare(String(left.givenAt)))[0];
  const episodeId = Utilities.getUuid();
  appendUnique('CareEpisodes', 'episodeId', { episodeId, patientId, startDate: bangkokToday(), endDate: '', eligibilityStatus: 'PENDING_ASSESSMENT', status: 'ACTIVE', fundingType: 'LTC', legalBasis: legalBasis || String(consent?.legalBasis ?? '') });
  return episodeId;
}

export function requireEnabledUser(userId: string, role: 'CG' | 'CM'): void {
  const user = getById('Users', 'userId', userId);
  if (!user || String(user.role) !== role || String(user.enabled).toLowerCase() !== 'true') throw new Error(role === 'CG' ? 'CAREGIVER_NOT_FOUND' : 'CARE_MANAGER_NOT_FOUND');
}

/**
 * Makes `caregiverUserId` the patient's caregiver: ends the previous CG assignment, moves upcoming
 * visits that have not started, and records the caregiver on the patient row. Call inside the lock.
 */
export function assignCaregiver(actorId: string, patientId: string, caregiverUserId: string): { episodeId: string; status: string; reassignedVisits: number } {
  const today = bangkokToday();
  const episodeId = activeEpisodeFor(patientId);
  const current = listAll('StaffAssignments', (row) => String(row.episodeId) === episodeId && isActiveCgAssignment(row));
  if (current.length === 1 && String(current[0]!.staffId) === caregiverUserId) return { episodeId, status: 'UNCHANGED', reassignedVisits: 0 };
  updateWhere('StaffAssignments', (row) => String(row.episodeId) === episodeId && isActiveCgAssignment(row), { status: 'ENDED', dateTo: today });
  appendUnique('StaffAssignments', 'assignmentId', { assignmentId: Utilities.getUuid(), episodeId, staffId: caregiverUserId, role: 'CG', dateFrom: today, dateTo: '', status: 'ACTIVE', assignedBy: actorId });
  const reassignedVisits = updateWhere('VisitSchedules', (row) => String(row.episodeId) === episodeId
    && ['PLANNED', 'ASSIGNED'].includes(String(row.status)) && String(row.visitDateTime).slice(0, 10) >= today, { assignedStaffId: caregiverUserId });
  if (headersOf(getSheet('Patients')).includes('caregiverId')) updateWhere('Patients', (row) => String(row.patientId) === patientId, { caregiverId: caregiverUserId });
  return { episodeId, status: 'ASSIGNED', reassignedVisits };
}

export function setAssignment(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'assignments:manage');
  const input = assignmentSetSchema.parse(payload);
  const patient = getById('Patients', 'patientId', input.patientId);
  if (!patient || String(patient.status) !== 'ACTIVE') throw new Error('PATIENT_NOT_FOUND');
  requireEnabledUser(input.caregiverUserId, 'CG');
  const result = withScriptLock(() => assignCaregiver(actor.userId, input.patientId, input.caregiverUserId));
  audit(actor.userId, 'assignment.set', 'CareEpisode', result.episodeId, 'SUCCESS', `CG:${input.caregiverUserId};VISITS:${result.reassignedVisits}`);
  return { patientId: input.patientId, caregiverUserId: input.caregiverUserId, ...result };
}

// The gateway replaces each CID with its ciphertext and lookup hash before forwarding.
const forwardedRowSchema = patientImportRowSchema.omit({ cid: true }).extend({
  cidCiphertext: z.string().min(1).max(500),
  cidLookupHash: z.string().min(1).max(200)
});
function savePhoto(userId: string, base64: string): { photoFileId: string; photoUrl: string } {
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length < 1 || bytes.length > 512 * 1024) throw new Error('FILE_SIZE_NOT_ALLOWED');
  // The file name carries the user id only, never the person's name.
  const file = staffPhotoFolder().createFile(Utilities.newBlob(bytes, 'image/jpeg', `staff_${userId}.jpg`));
  // lh3 links only open for files shared by link: synthetic DEMO data only, PILOT photos stay private.
  if (getAppMode() === 'DEMO') file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { photoFileId: file.getId(), photoUrl: `https://lh3.googleusercontent.com/d/${file.getId()}` };
}

/** A replaced or removed photo goes to the Drive trash, where the owner can still restore it. */
function trashPhoto(fileId: string): void {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) { console.warn(JSON.stringify({ code: 'PHOTO_TRASH_FAILED', fileId, error: String(error) })); }
}

function caregiverUser(userId: string): RowRecord {
  const user = getById('Users', 'userId', userId);
  if (!user || String(user.role) !== 'CG') throw new Error('CAREGIVER_NOT_FOUND');
  return user;
}

/** One caregiver for the edit form. The gateway turns the CID ciphertext into its last four digits. */
export function getCaregiver(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'users:manage');
  const { userId } = caregiverGetSchema.parse(payload);
  ensureSheet('CaregiverProfiles');
  const user = caregiverUser(userId);
  const profile = getById('CaregiverProfiles', 'userId', userId);
  const credential = listAll('AuthCredentials', (row) => String(row.userId) === userId && String(row.status) === 'ACTIVE')[0];
  return {
    userId, displayName: user.displayName, username: credential?.identifierNormalized ?? user.usernameNormalized ?? '',
    enabled: String(user.enabled).toLowerCase() === 'true',
    activePatients: listAll('StaffAssignments', (row) => isActiveCgAssignment(row) && String(row.staffId) === userId).length,
    cidCiphertext: profile?.cidCiphertext ?? '', birthDate: profile?.birthDate ?? '', phone: profile?.phone ?? '', address: profile?.address ?? '',
    email: profile?.email || user.email || '', photoUrl: profile?.photoUrl ?? '', education: profile?.education ?? '',
    organization: { name: profile?.organizationName ?? '', type: profile?.organizationType || 'HEALTH_PROMOTING_HOSPITAL', serviceArea: profile?.serviceArea ?? '' },
    trainings: trainingsOf(profile), recordVersion: Number(profile?.recordVersion ?? 0)
  };
}

const forwardedCaregiverUpdateSchema = caregiverUpdateSchema.omit({ cid: true }).extend({
  cidCiphertext: z.string().max(500),
  cidLookupHash: z.string().max(200)
});

/**
 * Saves an edit. The profile row is version-checked so two people editing the same caregiver
 * cannot silently overwrite each other; caregivers registered before profiles existed get one.
 */
export function updateCaregiver(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'users:manage');
  const input = forwardedCaregiverUpdateSchema.parse(payload);
  if (input.newPassword && getAppMode() !== 'DEMO') throw new Error('PASSWORD_AUTH_DISABLED');
  ensureSheet('CaregiverProfiles');
  const now = new Date().toISOString();
  const result = withScriptLock(() => {
    const user = caregiverUser(input.userId);
    const profile = getById('CaregiverProfiles', 'userId', input.userId);
    if (Number(profile?.recordVersion ?? 0) !== input.recordVersion) throw new Error('VERSION_CONFLICT');
    if (input.cidLookupHash && listAll('CaregiverProfiles', (row) => String(row.cidLookupHash) === input.cidLookupHash && String(row.userId) !== input.userId).length) throw new Error('DUPLICATE_STAFF_CID');
    let photo = { photoFileId: String(profile?.photoFileId ?? ''), photoUrl: String(profile?.photoUrl ?? '') };
    const previousPhoto = photo.photoFileId;
    if (input.photo) photo = savePhoto(input.userId, input.photo.base64);
    else if (input.removePhoto) photo = { photoFileId: '', photoUrl: '' };
    const changes = {
      userId: input.userId, birthDate: input.birthDate, phone: input.phone, address: input.address, email: input.email,
      ...photo, education: input.education, organizationName: input.organization.name, organizationType: input.organization.type,
      serviceArea: input.organization.serviceArea, trainingsJson: JSON.stringify(input.trainings),
      ...(input.cidCiphertext ? { cidCiphertext: input.cidCiphertext, cidLookupHash: input.cidLookupHash } : {})
    };
    const saved = profile
      ? versionedUpdate('CaregiverProfiles', 'userId', input.userId, input.recordVersion, changes)
      : appendUnique('CaregiverProfiles', 'userId', { cidCiphertext: '', cidLookupHash: '', ...changes, createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1 });
    updateWhere('Users', (row) => String(row.userId) === input.userId, { displayName: input.displayName, email: input.email, enabled: input.enabled ? 'true' : 'false', updatedAt: now });
    if (input.newPassword) {
      const credential = listAll('AuthCredentials', (row) => String(row.userId) === input.userId && String(row.status) === 'ACTIVE')[0];
      storePasswordCredential(input.userId, String(credential?.identifierNormalized || user.usernameNormalized), input.newPassword);
    }
    if (previousPhoto && previousPhoto !== photo.photoFileId) trashPhoto(previousPhoto);
    return { recordVersion: Number(saved.recordVersion) };
  });
  const notes = [input.enabled ? '' : 'DISABLED', input.newPassword ? 'PASSWORD_RESET' : '', input.cidCiphertext ? 'CID_CHANGED' : ''].filter(Boolean).join(';');
  audit(actor.userId, 'caregiver.update', 'User', input.userId, 'SUCCESS', notes);
  return { userId: input.userId, ...result };
}

const forwardedCaregiverSchema = caregiverCreateSchema.omit({ cid: true }).extend({
  cidCiphertext: z.string().min(1).max(500),
  cidLookupHash: z.string().min(1).max(200)
});

const forwardedImportSchema = patientImportSchema.omit({ rows: true }).extend({
  rows: z.array(forwardedRowSchema).min(1).max(MAX_IMPORT_ROWS_PER_REQUEST)
});

type SkipReason = 'DUPLICATE_HN' | 'DUPLICATE_CID' | 'POTENTIAL_DUPLICATE';

/**
 * Bulk registration from the unit's register. Each new patient gets an open care episode (pending
 * ADL assessment), and the CG named by sign-in name, if any. Rows that match an existing patient by
 * HN, CID, or name with birth date are skipped and reported, never merged: a CM resolves those one
 * by one. An unknown CG does not block the row: the patient is registered unassigned and reported.
 */
export function importPatients(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'patients:import');
  const input = forwardedImportSchema.parse(payload);
  if (input.rows.some((row) => row.caregiverUsername)) requireCapability(actor, 'assignments:manage');
  ensureColumns('Patients');
  const now = new Date().toISOString();
  const today = bangkokToday();
  const outcome = withScriptLock(() => {
    const existing = listAll('Patients', () => true);
    const hns = new Set(existing.map((row) => String(row.hn).toLowerCase()));
    const cids = new Set(existing.map((row) => String(row.cidLookupHash)).filter(Boolean));
    const people = new Set(existing.map((row) => `${String(row.fullName).toLocaleLowerCase('th')}|${String(row.birthDate)}`));
    // Sign-in name -> enabled caregiver, resolved once for the whole file.
    const enabledCaregivers = new Set(listAll('Users', (row) => String(row.role) === 'CG' && String(row.enabled).toLowerCase() === 'true').map((row) => String(row.userId)));
    const caregiverByName = new Map(listAll('AuthCredentials', (row) => String(row.status) === 'ACTIVE' && enabledCaregivers.has(String(row.userId)))
      .map((row) => [String(row.identifierNormalized).toLowerCase(), String(row.userId)]));
    const patients: RowRecord[] = [];
    const episodes: RowRecord[] = [];
    const consents: RowRecord[] = [];
    const assignments: RowRecord[] = [];
    const skipped: Array<{ line: number; hn: string; reason: SkipReason }> = [];
    const warnings: Array<{ line: number; hn: string; reason: 'CAREGIVER_NOT_FOUND'; detail: string }> = [];
    for (const row of input.rows) {
      const person = `${row.fullName.toLocaleLowerCase('th')}|${row.birthDate}`;
      const reason: SkipReason | null = hns.has(row.hn.toLowerCase()) ? 'DUPLICATE_HN' : cids.has(row.cidLookupHash) ? 'DUPLICATE_CID' : people.has(person) ? 'POTENTIAL_DUPLICATE' : null;
      if (reason) { skipped.push({ line: row.line, hn: row.hn, reason }); continue; }
      hns.add(row.hn.toLowerCase()); cids.add(row.cidLookupHash); people.add(person);
      const patientId = Utilities.getUuid();
      const episodeId = Utilities.getUuid();
      const caregiverId = row.caregiverUsername ? caregiverByName.get(row.caregiverUsername) ?? '' : '';
      if (row.caregiverUsername && !caregiverId) warnings.push({ line: row.line, hn: row.hn, reason: 'CAREGIVER_NOT_FOUND', detail: row.caregiverUsername });
      patients.push({
        patientId, localCode: row.localCode, hn: row.hn, cidCiphertext: row.cidCiphertext, cidLookupHash: row.cidLookupHash,
        fullName: row.fullName, birthDate: row.birthDate, sex: row.sex, address: row.address, phone: row.phone ?? '',
        village: villageLabel(row.villageNo, row.villageName, row.village),
        villageNo: row.villageNo ?? '', villageName: row.villageName ?? '', subdistrict: row.subdistrict ?? '', district: row.district ?? '', province: row.province ?? '',
        latitude: row.latitude ?? '', longitude: row.longitude ?? '',
        mainCaregiverName: row.mainCaregiverName ?? '', mainCaregiverPhone: row.mainCaregiverPhone ?? '', relationship: row.relationship ?? '',
        rightType: row.rightType ?? '', diseases: row.diseases ?? '', dependencyStatus: row.dependencyStatus ?? '',
        adlScore: row.adlScore ?? '', taiGroup: row.taiGroup ?? '', ppsScore: row.ppsScore ?? '', mentalHealthStatus: row.mentalHealthStatus ?? '',
        careManagerId: actor.role === 'CM' ? actor.userId : '', caregiverId, registerDate: row.registerDate || today,
        status: 'ACTIVE', createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
      });
      episodes.push({ episodeId, patientId, startDate: today, endDate: '', eligibilityStatus: 'PENDING_ASSESSMENT', status: 'ACTIVE', fundingType: 'LTC', legalBasis: input.legalBasis ?? '' });
      if (caregiverId) assignments.push({ assignmentId: Utilities.getUuid(), episodeId, staffId: caregiverId, role: 'CG', dateFrom: today, dateTo: '', status: 'ACTIVE', assignedBy: actor.userId });
      if (input.legalBasis) {
        consents.push({ consentId: Utilities.getUuid(), patientId, purpose: `LTC_CARE:${input.privacyNoticeVersion || 'UNSPECIFIED'}`, legalBasis: input.legalBasis, givenBy: actor.userId, evidenceFileId: '', givenAt: now, revokedAt: '' });
      }
    }
    for (const [name, records] of [['Patients', patients], ['CareEpisodes', episodes], ['StaffAssignments', assignments], ['PatientConsents', consents]] as const) {
      const sheet = getSheet(name);
      bulkAppend(sheet, headersOf(sheet), records);
    }
    return { created: patients.length, assigned: assignments.length, skipped, warnings };
  });
  audit(actor.userId, 'patient.import', 'Patient', '*', 'SUCCESS', `CREATED:${outcome.created};ASSIGNED:${outcome.assigned};SKIPPED:${outcome.skipped.length}`);
  return outcome;
}
