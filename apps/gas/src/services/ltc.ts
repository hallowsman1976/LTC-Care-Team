import type { Actor } from '@smart-ltc/shared';
import { classificationConfirmSchema, suggestLtcGroup } from '@smart-ltc/shared';
import { appendUnique } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';
import { latestApprovedAdl, resolveActiveEpisode } from './context';

export function confirmClassification(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'classification:confirm');
  const input = classificationConfirmSchema.parse(payload);
  const episode = resolveActiveEpisode(input.patientId);
  const assessment = latestApprovedAdl(String(episode.episodeId));
  const adlTotal = Number(assessment.totalScore);
  const suggestion = suggestLtcGroup({ adlTotal, ...input.observation });
  const classId = Utilities.getUuid();
  const now = new Date().toISOString();
  const record = appendUnique('LTCClassifications', 'classId', {
    classId, episodeId: String(episode.episodeId), assessmentId: String(assessment.assessmentId),
    adlTotal, mobilityStatus: input.observation.mobilityStatus, cognitiveStatus: input.observation.cognitiveStatus,
    terminalStatus: input.observation.terminalStatus,
    groupNumber: input.groupNumber, suggestedGroup: suggestion.groupNumber ?? '', decisionStatus: 'CONFIRMED',
    rationale: input.rationale, confirmedBy: actor.userId, effectiveAt: now,
    createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
  });
  audit(actor.userId, 'classification.confirm', 'LTCClassification', classId, 'SUCCESS',
    suggestion.groupNumber === input.groupNumber ? '' : `OVERRIDE_SUGGESTION:${suggestion.groupNumber ?? 'NONE'}`);
  return record;
}
