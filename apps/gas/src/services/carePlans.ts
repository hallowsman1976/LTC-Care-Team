import type { Actor } from '@smart-ltc/shared';
import { carePlanActivateSchema, carePlanCreateSchema } from '@smart-ltc/shared';
import { appendUnique, getById, listAll, listPage, versionedUpdate, withScriptLock } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';
import { resolveActiveEpisode } from './context';

export function createCarePlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'carePlan:approve');
  const input = carePlanCreateSchema.parse(payload);
  const episodeId = String(resolveActiveEpisode(input.patientId).episodeId);
  const carePlanId = Utilities.getUuid();
  const now = new Date().toISOString();
  const plan = withScriptLock(() => {
    const version = listAll('CarePlans', (row) => String(row.episodeId) === episodeId)
      .reduce((max, row) => Math.max(max, Number(row.version) || 0), 0) + 1;
    const created = appendUnique('CarePlans', 'carePlanId', {
      carePlanId, episodeId, version,
      rulesetId: input.rulesetId, cmId: actor.userId,
      effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      status: 'DRAFT', approvedBy: '', approvedAt: '', approvalRationale: '',
      goalsSummary: input.goalsSummary,
      createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
    });
    const { schedulePattern } = input.intervention;
    appendUnique('CarePlanInterventions', 'interventionId', {
      interventionId: Utilities.getUuid(), carePlanId, problemId: '', serviceType: input.intervention.serviceType,
      instructions: input.intervention.instructions, count: schedulePattern.count, unit: schedulePattern.unit, durationMinutes: '',
      dateFrom: input.effectiveFrom, dateTo: input.effectiveTo, requiredQualification: '', schedulePatternJson: JSON.stringify(schedulePattern)
    });
    return created;
  });
  audit(actor.userId, 'carePlan.create', 'CarePlan', carePlanId, 'SUCCESS');
  return plan;
}

export function activateCarePlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'carePlan:approve');
  const input = carePlanActivateSchema.parse(payload);
  const plan = getById('CarePlans', 'carePlanId', input.carePlanId);
  if (!plan || String(plan.status) !== 'DRAFT') throw new Error('PLAN_NOT_ACTIVATABLE');
  const episode = getById('CareEpisodes', 'episodeId', String(plan.episodeId));
  if (!episode || String(episode.status) !== 'ACTIVE' || !String(episode.legalBasis)) throw new Error('ACTIVE_EPISODE_WITH_LEGAL_BASIS_REQUIRED');
  if (!listPage('LTCClassifications', (row) => String(row.episodeId) === String(plan.episodeId) && String(row.decisionStatus) === 'CONFIRMED', 1).length) throw new Error('CONFIRMED_CLASSIFICATION_REQUIRED');
  const ruleset = getById('ServiceRuleSets', 'rulesetId', String(plan.rulesetId));
  if (!ruleset || String(ruleset.status) !== 'APPROVED') throw new Error('APPROVED_RULESET_REQUIRED');
  if (!listPage('CarePlanInterventions', (row) => String(row.carePlanId) === input.carePlanId, 1).length) throw new Error('INTERVENTION_REQUIRED');
  if (!listPage('StaffAssignments', (row) => String(row.episodeId) === String(plan.episodeId) && String(row.status) === 'ACTIVE', 1).length) throw new Error('ACTIVE_ASSIGNMENT_REQUIRED');
  const rationale = input.approvalRationale;
  if (String(plan.createdBy) === actor.userId && rationale.length < 10) throw new Error('SELF_APPROVAL_RATIONALE_REQUIRED');
  const now = new Date().toISOString();
  const active = versionedUpdate('CarePlans', 'carePlanId', input.carePlanId, input.recordVersion, {
    ...plan, status: 'ACTIVE', approvedBy: actor.userId, approvedAt: now, approvalRationale: rationale
  });
  audit(actor.userId, 'carePlan.activate', 'CarePlan', input.carePlanId, 'SUCCESS', String(plan.createdBy) === actor.userId ? 'SELF_APPROVAL' : '');
  return active;
}
