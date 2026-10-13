import type { Actor } from '@smart-ltc/shared';
import { adlAssessmentItemsSchema, calculateAdlTotal } from '@smart-ltc/shared';
import { appendUnique } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

export function createAdlAssessment(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'adl:approve');
  const items = adlAssessmentItemsSchema.parse(payload.items);
  const totalScore = calculateAdlTotal(items);
  const assessmentId = Utilities.getUuid();
  const now = new Date().toISOString();
  const record = appendUnique('ADLAssessments', 'assessmentId', {
    assessmentId,
    episodeId: String(payload.episodeId ?? ''),
    assessorId: actor.userId,
    assessmentDate: String(payload.assessmentDate ?? ''),
    ...items,
    totalScore,
    scoringVersion: 'TH-BARTHEL-20-v1',
    approvedBy: actor.userId,
    status: 'APPROVED',
    createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
  });
  audit(actor.userId, 'adl.create', 'ADLAssessment', assessmentId, 'SUCCESS');
  return record;
}

