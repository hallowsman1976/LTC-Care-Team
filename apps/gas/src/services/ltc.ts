import type { Actor } from '@smart-ltc/shared';
import { suggestLtcGroup, type LtcDecisionInput } from '@smart-ltc/shared';
import { appendUnique } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

export function confirmClassification(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'classification:confirm');
  const rationale = String(payload.rationale ?? '').trim();
  if (rationale.length < 10) throw new Error('RATIONALE_REQUIRED');
  const input = payload.input as unknown as LtcDecisionInput;
  const suggestion = suggestLtcGroup(input);
  const confirmedGroup = Number(payload.groupNumber);
  if (![1, 2, 3, 4].includes(confirmedGroup)) throw new Error('INVALID_GROUP');
  const classId = Utilities.getUuid();
  const now = new Date().toISOString();
  const record = appendUnique('LTCClassifications', 'classId', {
    classId, episodeId: String(payload.episodeId ?? ''), assessmentId: String(payload.assessmentId ?? ''),
    ...input, groupNumber: confirmedGroup, decisionStatus: 'CONFIRMED', rationale,
    suggestedGroup: suggestion.groupNumber ?? '', confirmedBy: actor.userId, effectiveAt: now,
    createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
  });
  audit(actor.userId, 'classification.confirm', 'LTCClassification', classId, 'SUCCESS');
  return record;
}

