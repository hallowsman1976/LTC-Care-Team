import type { Actor } from '@smart-ltc/shared';
import { getById, versionedUpdate } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

export function reviewEncounter(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'encounter:review');
  const encounterId = String(payload.encounterId ?? '');
  const decision = String(payload.decision ?? '');
  if (!['VERIFIED', 'RETURNED'].includes(decision)) throw new Error('INVALID_REVIEW_DECISION');
  const reviewNotes = String(payload.reviewNotes ?? '').trim();
  if (decision === 'RETURNED' && reviewNotes.length < 10) throw new Error('RETURN_REASON_REQUIRED');
  const encounter = getById('VisitEncounters', 'encounterId', encounterId);
  if (!encounter || String(encounter.status) !== 'SUBMITTED') throw new Error('ENCOUNTER_NOT_REVIEWABLE');
  const updated = versionedUpdate('VisitEncounters', 'encounterId', encounterId, Number(payload.recordVersion), {
    ...encounter, status: decision, reviewedBy: actor.userId, reviewedAt: new Date().toISOString(), reviewNotes
  });
  audit(actor.userId, 'encounter.review', 'VisitEncounter', encounterId, 'SUCCESS', decision);
  return updated;
}

