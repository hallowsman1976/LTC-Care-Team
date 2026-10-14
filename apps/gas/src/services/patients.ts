import { z } from 'zod';
import { patientCreateSchema, type Actor, type Page } from '@smart-ltc/shared';
import { appendUnique, listAll, listPage, pageOf, withScriptLock, type RowRecord } from '../repositories/sheets';
import { ensureColumns } from '../initializer';
import { activeEpisodeFor, assignCaregiver, requireEnabledUser } from './admin';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

// The gateway replaces the CID with its ciphertext and keyed lookup hash before forwarding.
const forwardedPatientSchema = patientCreateSchema.omit({ cid: true }).extend({
  cidCiphertext: z.string().max(500).default(''),
  cidLookupHash: z.string().max(200).default('')
});

/** "หมู่ 2 บ้านหนองบัว" for lists, from the village number and name when given. */
function villageLabel(villageNo?: string, villageName?: string, fallback = ''): string {
  const parts = [villageNo ? `หมู่ ${villageNo}` : '', villageName ? (villageName.startsWith('บ้าน') ? villageName : `บ้าน${villageName}`) : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : fallback;
}

export function createPatient(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'patients:write');
  if (actor.role !== 'CM') throw new Error('CM_REQUIRED');
  const input = forwardedPatientSchema.parse(payload);
  if (input.caregiverId) requireCapability(actor, 'assignments:manage');
  ensureColumns('Patients');
  const hn = input.hn;
  const fullName = input.fullName;
  const birthDate = input.birthDate;
  if (listPage('Patients', (row) => String(row.hn).toLowerCase() === hn.toLowerCase(), 1).length) throw new Error('DUPLICATE_HN');
  const cidLookupHash = input.cidLookupHash;
  if (cidLookupHash && listPage('Patients', (row) => String(row.cidLookupHash) === cidLookupHash, 1).length) throw new Error('DUPLICATE_CID');
  const candidates = listPage('Patients', (row) =>
    String(row.fullName).toLocaleLowerCase('th') === fullName.toLocaleLowerCase('th')
      && String(row.birthDate) === birthDate, 10
  );
  const overrideReason = String(input.duplicateOverrideReason ?? '').trim();
  if (candidates.length && overrideReason.length < 10) {
    return { status: 'POTENTIAL_DUPLICATE', candidates: candidates.map((row) => ({ patientId: row.patientId, localCode: row.localCode, hn: row.hn, fullName: row.fullName, birthDate: row.birthDate })) };
  }
  if (input.careManagerId) requireEnabledUser(input.careManagerId, 'CM');
  if (input.caregiverId) requireEnabledUser(input.caregiverId, 'CG');
  const patientId = Utilities.getUuid();
  const now = new Date().toISOString();
  const legalBasis = input.legalBasis ?? '';
  const privacyNoticeVersion = String(input.privacyNoticeVersion ?? '').trim();
  const record = withScriptLock(() => {
    const created = appendUnique('Patients', 'patientId', {
      patientId, localCode: input.localCode, hn, cidCiphertext: input.cidCiphertext, cidLookupHash,
      fullName, birthDate, sex: input.sex, address: input.address, phone: input.phone ?? '',
      village: villageLabel(input.villageNo, input.villageName, input.village),
      villageNo: input.villageNo ?? '', villageName: input.villageName ?? '', subdistrict: input.subdistrict ?? '', district: input.district ?? '', province: input.province ?? '',
      latitude: input.latitude ?? '', longitude: input.longitude ?? '',
      mainCaregiverName: input.mainCaregiverName ?? '', mainCaregiverPhone: input.mainCaregiverPhone ?? '', relationship: input.relationship ?? '',
      rightType: input.rightType ?? '', diseases: input.diseases ?? '', dependencyStatus: input.dependencyStatus ?? '',
      adlScore: input.adlScore ?? '', taiGroup: input.taiGroup ?? '', ppsScore: input.ppsScore ?? '', mentalHealthStatus: input.mentalHealthStatus ?? '',
      // The registering CM is responsible unless another one is named.
      careManagerId: input.careManagerId || actor.userId, caregiverId: '',
      registerDate: input.registerDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
      status: 'ACTIVE', createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
    });
    if (legalBasis) {
      appendUnique('PatientConsents', 'consentId', {
        consentId: Utilities.getUuid(), patientId, purpose: `LTC_CARE:${privacyNoticeVersion || 'UNSPECIFIED'}`,
        legalBasis, givenBy: actor.userId, evidenceFileId: '', givenAt: now, revokedAt: ''
      });
    }
    // Every registered patient gets an open care episode, so ADL assessment can start straight away.
    activeEpisodeFor(patientId, legalBasis);
    if (input.caregiverId) {
      assignCaregiver(actor.userId, patientId, input.caregiverId);
      created.caregiverId = input.caregiverId;
    }
    return created;
  });
  audit(actor.userId, 'patient.create', 'Patient', patientId, 'SUCCESS', [overrideReason ? 'DUPLICATE_OVERRIDE_RECORDED' : '', input.caregiverId ? `CG:${input.caregiverId}` : ''].filter(Boolean).join(';'));
  return { status: 'CREATED', patient: { ...record, cidCiphertext: undefined, cidLookupHash: undefined } };
}

export function listPatients(actor: Actor, payload: Record<string, unknown>): Page<RowRecord> {
  requireCapability(actor, 'patients:read');
  const limit = Number(payload.limit ?? 25);
  if (actor.role === 'CG') {
    // Full scans here: capping the assignment lookup would silently hide assigned patients.
    const assignments = listAll('StaffAssignments', (row) => String(row.staffId) === actor.userId && String(row.status) === 'ACTIVE');
    const episodeIds = new Set(assignments.map((row) => String(row.episodeId)));
    const episodes = listAll('CareEpisodes', (row) => episodeIds.has(String(row.episodeId)));
    const patientIds = new Set(episodes.map((row) => String(row.patientId)));
    const page = pageOf('Patients', (row) => patientIds.has(String(row.patientId)), limit);
    return { items: page.items.map(projectCgPatient), hasMore: page.hasMore };
  }
  const page = pageOf('Patients', () => true, limit);
  return { items: page.items.map((row) => ({ ...row, cidCiphertext: undefined, cidLookupHash: undefined })), hasMore: page.hasMore };
}

export function exportPatients(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'export:phi');
  if (actor.role !== 'CM') throw new Error('CM_REQUIRED');
  const items = listAll('Patients', () => true).map((row) => ({
    hn: row.hn, cidCiphertext: row.cidCiphertext, fullName: row.fullName, birthDate: row.birthDate
  }));
  audit(actor.userId, 'patient.export', 'Patient', '*', 'SUCCESS', `COUNT:${items.length}`);
  return { items, hasMore: false };
}

/** What a caregiver needs on a home visit: no CID, rights or register details. */
function projectCgPatient(row: Record<string, unknown>): Record<string, unknown> {
  return {
    patientId: row.patientId, localCode: row.localCode, fullName: row.fullName, sex: row.sex,
    birthDate: row.birthDate, address: row.address, village: row.village, subdistrict: row.subdistrict, district: row.district, province: row.province,
    latitude: row.latitude, longitude: row.longitude, phone: row.phone, mainCaregiverName: row.mainCaregiverName, mainCaregiverPhone: row.mainCaregiverPhone,
    relationship: row.relationship, diseases: row.diseases, dependencyStatus: row.dependencyStatus, status: row.status
  };
}

