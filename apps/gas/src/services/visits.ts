import type { Actor } from '@smart-ltc/shared';
import { visitSubmitSchema } from '@smart-ltc/shared';
import { appendUnique, getById, withScriptLock } from '../repositories/sheets';
import { audit } from '../security/audit';

export function submitVisit(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  const input = visitSubmitSchema.parse(payload);
  // The receipt lookup and both writes share one lock so a retried submission cannot slip in between.
  return withScriptLock(() => {
    if (getById('SyncReceipts', 'submissionId', input.submissionId)) {
      const existing = getById('VisitEncounters', 'submissionId', input.submissionId);
      if (!existing) throw new Error('PARTIAL_COMMIT_REQUIRES_RECONCILIATION');
      return existing;
    }
    const visit = getById('VisitSchedules', 'visitId', input.visitId);
    if (!visit || String(visit.assignedStaffId) !== actor.userId) throw new Error('VISIT_NOT_ASSIGNED');
    const encounterId = Utilities.getUuid();
    const now = new Date().toISOString();
    const encounter = appendUnique('VisitEncounters', 'encounterId', {
      encounterId, visitId: input.visitId, episodeId: visit.episodeId, performerId: actor.userId,
      startedAt: input.startedAt, endedAt: input.endedAt, source: input.source, notes: input.notes,
      vitalsJson: JSON.stringify(input.vitals), submissionId: input.submissionId, status: 'SUBMITTED',
      reviewedBy: '', reviewedAt: '', reviewNotes: '',
      createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
    });
    appendUnique('SyncReceipts', 'submissionId', {
      submissionId: input.submissionId, actorId: actor.userId, entityType: 'VisitEncounter', entityId: encounterId,
      receivedAt: now, result: 'COMMITTED', checksum: input.checksum ?? ''
    });
    if (input.urgentFlag) {
      // The caregiver asked for CM attention; surface it on the CM alert list rather than dropping it.
      appendUnique('Alerts', 'alertId', {
        alertId: Utilities.getUuid(), episodeId: visit.episodeId, encounterId, severity: 'HIGH',
        alertType: 'CG_URGENT_FLAG', eventAt: now, status: 'OPEN', assignedTo: '', closedAt: ''
      });
    }
    audit(actor.userId, 'visit.submit', 'VisitEncounter', encounterId, 'SUCCESS', input.urgentFlag ? 'URGENT_FLAG' : '');
    return encounter;
  });
}
