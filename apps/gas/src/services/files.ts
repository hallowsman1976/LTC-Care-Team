import type { Actor } from '@smart-ltc/shared';
import { getRequiredProperty } from '../config';
import { appendUnique, getById } from '../repositories/sheets';
import { audit } from '../security/audit';

const allowedMime = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const maxBytes = 5 * 1024 * 1024;

export function uploadQuarantinedFile(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  const encounterId = String(payload.encounterId ?? '');
  const encounter = getById('VisitEncounters', 'encounterId', encounterId);
  if (!encounter || String(encounter.performerId) !== actor.userId) throw new Error('ENCOUNTER_NOT_ASSIGNED');
  const consentRef = String(payload.consentRef ?? '');
  const consent = getById('PatientConsents', 'consentId', consentRef);
  if (!consent || String(consent.revokedAt)) throw new Error('ACTIVE_CONSENT_REQUIRED');
  const mimeType = String(payload.mimeType ?? '');
  if (!allowedMime.has(mimeType)) throw new Error('FILE_TYPE_NOT_ALLOWED');
  const bytes = Utilities.base64Decode(String(payload.base64 ?? ''));
  if (bytes.length < 1 || bytes.length > maxBytes) throw new Error('FILE_SIZE_NOT_ALLOWED');
  const safeName = `${Utilities.getUuid()}.${mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg'}`;
  const file = DriveApp.getFolderById(getRequiredProperty('QUARANTINE_FOLDER_ID')).createFile(Utilities.newBlob(bytes, mimeType, safeName));
  const fileRecordId = Utilities.getUuid();
  const record = appendUnique('VisitFiles', 'fileRecordId', {
    fileRecordId, encounterId, driveFileId: file.getId(), fileName: safeName,
    mimeType, fileSize: bytes.length, uploadedBy: actor.userId, consentRef, scanStatus: 'PENDING_SCAN'
  });
  audit(actor.userId, 'file.upload', 'VisitFile', fileRecordId, 'SUCCESS', 'QUARANTINED');
  return record;
}

