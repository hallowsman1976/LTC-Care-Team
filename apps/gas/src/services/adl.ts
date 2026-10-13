import type { Actor } from '@smart-ltc/shared';
import { adlCreateSchema, calculateAdlTotal } from '@smart-ltc/shared';
import { appendUnique } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';
import { resolveActiveEpisode } from './context';

export function createAdlAssessment(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'adl:approve');
  const input = adlCreateSchema.parse(payload);
  const episode = resolveActiveEpisode(input.patientId);
  const totalScore = calculateAdlTotal(input.items);
  const assessmentId = Utilities.getUuid();
  const now = new Date().toISOString();
  const record = appendUnique('ADLAssessments', 'assessmentId', {
    assessmentId,
    episodeId: String(episode.episodeId),
    assessorId: actor.userId,
    assessmentDate: input.assessmentDate,
    ...input.items,
    totalScore,
    scoringVersion: 'TH-BARTHEL-20-v1',
    approvedBy: actor.userId,
    status: 'APPROVED',
    createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
  });
  audit(actor.userId, 'adl.create', 'ADLAssessment', assessmentId, 'SUCCESS');
  return record;
}
