import type { Actor } from '@smart-ltc/shared';
import { appendUnique, getById } from '../repositories/sheets';
import { audit } from '../security/audit';

export function submitVisit(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  const submissionId = String(payload.submissionId ?? '');
  if (!submissionId) throw new Error('SUBMISSION_ID_REQUIRED');
  const previous = getById('SyncReceipts', 'submissionId', submissionId);
  if (previous) {
    const existing = getById('VisitEncounters', 'submissionId', submissionId);
    if (!existing) throw new Error('PARTIAL_COMMIT_REQUIRES_RECONCILIATION');
    return existing;
  }
  const visitId = String(payload.visitId ?? '');
  const visit = getById('VisitSchedules', 'visitId', visitId);
  if (!visit || String(visit.assignedStaffId) !== actor.userId) throw new Error('VISIT_NOT_ASSIGNED');
  const encounterId = Utilities.getUuid();
  const now = new Date().toISOString();
  const encounter = appendUnique('VisitEncounters', 'encounterId', {
    encounterId, visitId, episodeId: visit.episodeId, performerId: actor.userId,
    startedAt: String(payload.startedAt ?? ''), endedAt: String(payload.endedAt ?? ''),
    source: String(payload.source ?? 'ONLINE'), notes: String(payload.notes ?? ''),
    vitalsJson: JSON.stringify(payload.vitals ?? {}), submissionId, status: 'SUBMITTED',
    reviewedBy: '', reviewedAt: '', reviewNotes: '',
    createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
  });
  appendUnique('SyncReceipts', 'submissionId', {
    submissionId, actorId: actor.userId, entityType: 'VisitEncounter', entityId: encounterId,
    receivedAt: now, result: 'COMMITTED', checksum: String(payload.checksum ?? '')
  });
  audit(actor.userId, 'visit.submit', 'VisitEncounter', encounterId, 'SUCCESS');
  return encounter;
}

