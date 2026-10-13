import type { Actor } from '@smart-ltc/shared';
import { appendUnique, listPage } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

export function createPatient(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'patients:write');
  if (actor.role !== 'CM') throw new Error('CM_REQUIRED');
  const hn = String(payload.hn ?? '').trim();
  const fullName = String(payload.fullName ?? '').trim();
  const birthDate = String(payload.birthDate ?? '');
  if (!hn || fullName.length < 2 || !birthDate) throw new Error('INVALID_PATIENT');
  if (listPage('Patients', (row) => String(row.hn).toLowerCase() === hn.toLowerCase(), 1).length) throw new Error('DUPLICATE_HN');
  const cidLookupHash = String(payload.cidLookupHash ?? '');
  if (cidLookupHash && listPage('Patients', (row) => String(row.cidLookupHash) === cidLookupHash, 1).length) throw new Error('DUPLICATE_CID');
  const candidates = listPage('Patients', (row) =>
    String(row.fullName).toLocaleLowerCase('th') === fullName.toLocaleLowerCase('th')
      && String(row.birthDate) === birthDate, 10
  );
  const overrideReason = String(payload.duplicateOverrideReason ?? '').trim();
  if (candidates.length && overrideReason.length < 10) {
    return { status: 'POTENTIAL_DUPLICATE', candidates: candidates.map((row) => ({ patientId: row.patientId, localCode: row.localCode, hn: row.hn, fullName: row.fullName, birthDate: row.birthDate })) };
  }
  const patientId = Utilities.getUuid();
  const now = new Date().toISOString();
  const record = appendUnique('Patients', 'patientId', {
    patientId, localCode: String(payload.localCode ?? ''), hn,
    cidCiphertext: String(payload.cidCiphertext ?? ''), cidLookupHash: String(payload.cidLookupHash ?? ''),
    fullName, birthDate, sex: String(payload.sex ?? 'UNKNOWN'), address: String(payload.address ?? ''),
    village: String(payload.village ?? ''), phone: String(payload.phone ?? ''), status: 'ACTIVE',
    createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
  });
  const legalBasis = String(payload.legalBasis ?? '').trim();
  const privacyNoticeVersion = String(payload.privacyNoticeVersion ?? '').trim();
  if (legalBasis) {
    appendUnique('PatientConsents', 'consentId', {
      consentId: Utilities.getUuid(), patientId, purpose: `LTC_CARE:${privacyNoticeVersion || 'UNSPECIFIED'}`,
      legalBasis, givenBy: actor.userId, evidenceFileId: '', givenAt: now, revokedAt: ''
    });
  }
  audit(actor.userId, 'patient.create', 'Patient', patientId, 'SUCCESS', overrideReason ? 'DUPLICATE_OVERRIDE_RECORDED' : '');
  return { status: 'CREATED', patient: record };
}

export function listPatients(actor: Actor, payload: Record<string, unknown>): Record<string, unknown>[] {
  requireCapability(actor, 'patients:read');
  const limit = Number(payload.limit ?? 25);
  if (actor.role === 'CG') {
    const assignments = listPage('StaffAssignments', (row) => String(row.staffId) === actor.userId && String(row.status) === 'ACTIVE', 50);
    const episodeIds = new Set(assignments.map((row) => String(row.episodeId)));
    const episodes = listPage('CareEpisodes', (row) => episodeIds.has(String(row.episodeId)), 50);
    const patientIds = new Set(episodes.map((row) => String(row.patientId)));
    return listPage('Patients', (row) => patientIds.has(String(row.patientId)), limit).map(projectCgPatient);
  }
  return listPage('Patients', () => true, limit).map((row) => ({ ...row, cidCiphertext: undefined, cidLookupHash: undefined }));
}

export function exportPatients(actor: Actor): Record<string, unknown>[] {
  requireCapability(actor, 'export:phi');
  if (actor.role !== 'CM') throw new Error('CM_REQUIRED');
  const rows = listPage('Patients', () => true, 50).map((row) => ({
    hn: row.hn, cidCiphertext: row.cidCiphertext, fullName: row.fullName, birthDate: row.birthDate
  }));
  audit(actor.userId, 'patient.export', 'Patient', '*', 'SUCCESS', `COUNT:${rows.length}`);
  return rows;
}

function projectCgPatient(row: Record<string, unknown>): Record<string, unknown> {
  return {
    patientId: row.patientId, localCode: row.localCode, fullName: row.fullName,
    birthDate: row.birthDate, address: row.address, village: row.village, phone: row.phone, status: row.status
  };
}

