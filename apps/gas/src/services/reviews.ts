import type { Actor } from '@smart-ltc/shared';
import { encounterReviewSchema } from '@smart-ltc/shared';
import { getById, updateWhere, versionedUpdate, withScriptLock } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

export function reviewEncounter(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'encounter:review');
  const input = encounterReviewSchema.parse(payload);
  const encounter = getById('VisitEncounters', 'encounterId', input.encounterId);
  if (!encounter || String(encounter.status) !== 'SUBMITTED') throw new Error('ENCOUNTER_NOT_REVIEWABLE');
  const updated = withScriptLock(() => {
    const result = versionedUpdate('VisitEncounters', 'encounterId', input.encounterId, input.recordVersion, {
      ...encounter, status: input.decision, reviewedBy: actor.userId, reviewedAt: new Date().toISOString(), reviewNotes: input.reviewNotes
    });
    // A verified visit is done; the dashboard stops counting it as due or overdue.
    if (input.decision === 'VERIFIED') updateWhere('VisitSchedules', (row) => String(row.visitId) === String(encounter.visitId), { status: 'VERIFIED' });
    return result;
  });
  audit(actor.userId, 'encounter.review', 'VisitEncounter', input.encounterId, 'SUCCESS', input.decision);
  return updated;
}
