import type { Actor } from '@smart-ltc/shared';
import { fileUploadSchema, MAX_UPLOAD_BYTES } from '@smart-ltc/shared';
import { getRequiredProperty } from '../config';
import { appendUnique, getById } from '../repositories/sheets';
import { audit } from '../security/audit';

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' } as const;

export function uploadQuarantinedFile(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  const input = fileUploadSchema.parse(payload);
  const encounter = getById('VisitEncounters', 'encounterId', input.encounterId);
  if (!encounter || String(encounter.performerId) !== actor.userId) throw new Error('ENCOUNTER_NOT_ASSIGNED');
  const consent = getById('PatientConsents', 'consentId', input.consentRef);
  if (!consent || String(consent.revokedAt)) throw new Error('ACTIVE_CONSENT_REQUIRED');
  const bytes = Utilities.base64Decode(input.base64);
  if (bytes.length < 1 || bytes.length > MAX_UPLOAD_BYTES) throw new Error('FILE_SIZE_NOT_ALLOWED');
  const safeName = `${Utilities.getUuid()}.${extensions[input.mimeType]}`;
  const file = DriveApp.getFolderById(getRequiredProperty('QUARANTINE_FOLDER_ID')).createFile(Utilities.newBlob(bytes, input.mimeType, safeName));
  const fileRecordId = Utilities.getUuid();
  const record = appendUnique('VisitFiles', 'fileRecordId', {
    fileRecordId, encounterId: input.encounterId, driveFileId: file.getId(), fileName: safeName,
    mimeType: input.mimeType, fileSize: bytes.length, uploadedBy: actor.userId, consentRef: input.consentRef, scanStatus: 'PENDING_SCAN'
  });
  audit(actor.userId, 'file.upload', 'VisitFile', fileRecordId, 'SUCCESS', 'QUARANTINED');
  return record;
}
