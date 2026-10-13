import type { Actor } from '@smart-ltc/shared';
import { appendUnique, getById, listPage, versionedUpdate } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

export function createCarePlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'carePlan:approve');
  const carePlanId = Utilities.getUuid();
  const now = new Date().toISOString();
  const priorPlans = listPage('CarePlans', (row) => String(row.episodeId) === String(payload.episodeId ?? ''), 50);
  const version = priorPlans.reduce((max, row) => Math.max(max, Number(row.version) || 0), 0) + 1;
  const plan = appendUnique('CarePlans', 'carePlanId', {
    carePlanId, episodeId: String(payload.episodeId ?? ''), version,
    rulesetId: String(payload.rulesetId ?? ''), cmId: actor.userId,
    effectiveFrom: String(payload.effectiveFrom ?? ''), effectiveTo: String(payload.effectiveTo ?? ''),
    status: 'DRAFT', approvedBy: '', approvedAt: '', approvalRationale: '',
    goalsSummary: String(payload.goalsSummary ?? ''),
    createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
  });
  audit(actor.userId, 'carePlan.create', 'CarePlan', carePlanId, 'SUCCESS');
  return plan;
}

export function activateCarePlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'carePlan:approve');
  const carePlanId = String(payload.carePlanId ?? '');
  const expectedVersion = Number(payload.recordVersion);
  const plan = getById('CarePlans', 'carePlanId', carePlanId);
  if (!plan || String(plan.status) !== 'DRAFT') throw new Error('PLAN_NOT_ACTIVATABLE');
  const episode = getById('CareEpisodes', 'episodeId', String(plan.episodeId));
  if (!episode || String(episode.status) !== 'ACTIVE' || !String(episode.legalBasis)) throw new Error('ACTIVE_EPISODE_WITH_LEGAL_BASIS_REQUIRED');
  if (!listPage('LTCClassifications', (row) => String(row.episodeId) === String(plan.episodeId) && String(row.decisionStatus) === 'CONFIRMED', 1).length) throw new Error('CONFIRMED_CLASSIFICATION_REQUIRED');
  const ruleset = getById('ServiceRuleSets', 'rulesetId', String(plan.rulesetId));
  if (!ruleset || String(ruleset.status) !== 'APPROVED') throw new Error('APPROVED_RULESET_REQUIRED');
  if (!listPage('CarePlanInterventions', (row) => String(row.carePlanId) === carePlanId, 1).length) throw new Error('INTERVENTION_REQUIRED');
  if (!listPage('StaffAssignments', (row) => String(row.episodeId) === String(plan.episodeId) && String(row.status) === 'ACTIVE', 1).length) throw new Error('ACTIVE_ASSIGNMENT_REQUIRED');
  const rationale = String(payload.approvalRationale ?? '').trim();
  if (String(plan.createdBy) === actor.userId && rationale.length < 10) throw new Error('SELF_APPROVAL_RATIONALE_REQUIRED');
  const now = new Date().toISOString();
  const active = versionedUpdate('CarePlans', 'carePlanId', carePlanId, expectedVersion, {
    ...plan, status: 'ACTIVE', approvedBy: actor.userId, approvedAt: now, approvalRationale: rationale
  });
  audit(actor.userId, 'carePlan.activate', 'CarePlan', carePlanId, 'SUCCESS', String(plan.createdBy) === actor.userId ? 'SELF_APPROVAL' : '');
  return active;
}

