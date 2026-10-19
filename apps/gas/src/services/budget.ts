import {
  budgetApproveSchema, budgetCreateSchema, budgetGetSchema, budgetReviseSchema, budgetSaveSchema, budgetSettingsSchema, budgetSyncSchema,
  DEFAULT_BUDGET_SETTINGS, fiscalYearRange, serviceCoverage, summarizeBudget,
  type Actor, type BudgetGroup, type BudgetLine, type BudgetLineEdit, type BudgetPlanDetail, type BudgetPlanSummary, type BudgetPlanStatus, type BudgetSettings, type Page
} from '@smart-ltc/shared';
import { ensureSheet } from '../initializer';
import { appendUnique, getById, listAll, replaceRows, updateWhere, versionedUpdate, withScriptLock, type RowRecord } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';
import { audit } from '../security/audit';

// LTC budget plans, one per fiscal year (with revisions). Lines are pulled from the register:
// who was in care during the year, their confirmed group, time in care and caregiver. The CM's
// figures are saved over them; approval locks the plan, and a revision is a new version.

const TIME_ZONE = 'Asia/Bangkok';

function ready(): void {
  ensureSheet('BudgetPlans');
  ensureSheet('BudgetLines');
}

/** Sheets may hand back a date cell as a Date; everything here compares yyyy-MM-dd text. */
const dateText = (value: unknown) => (value instanceof Date ? Utilities.formatDate(value, TIME_ZONE, 'yyyy-MM-dd') : String(value ?? '').slice(0, 10));
const numberOrNull = (value: unknown) => (value === '' || value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value));
const isTrue = (value: unknown) => String(value).toLowerCase() === 'true';
const groupOf = (value: unknown): BudgetGroup | null => ([1, 2, 3, 4].includes(Number(value)) && value !== '' ? Number(value) as BudgetGroup : null);

function settingsOf(plan: RowRecord): BudgetSettings {
  try {
    return budgetSettingsSchema.parse({ ...DEFAULT_BUDGET_SETTINGS, ...JSON.parse(String(plan.settingsJson || '{}')) as object });
  } catch {
    return DEFAULT_BUDGET_SETTINGS;
  }
}

function lineOf(row: RowRecord): BudgetLine {
  return {
    lineId: String(row.lineId), patientId: String(row.patientId), fullName: String(row.fullName), age: numberOrNull(row.age), address: String(row.address ?? ''),
    adlScore: numberOrNull(row.adlScore), groupNumber: groupOf(row.groupNumber),
    serviceFrom: dateText(row.serviceFrom), serviceTo: dateText(row.serviceTo), serviceDays: Number(row.serviceDays) || 0, serviceMonths: Number(row.serviceMonths) || 0,
    caregiverName: String(row.caregiverName ?? ''), caregiverChanged: isTrue(row.caregiverChanged),
    diapersPerDay: Number(row.diapersPerDay) || 0, diaperCount: numberOrNull(row.diaperCount), otherSupplies: Number(row.otherSupplies) || 0,
    assessFee: numberOrNull(row.assessFee), reassessFee: numberOrNull(row.reassessFee), teamFee: numberOrNull(row.teamFee), cgMonthly: numberOrNull(row.cgMonthly),
    excluded: isTrue(row.excluded), excludeReason: String(row.excludeReason ?? ''), note: String(row.note ?? '')
  };
}

const rowOfLine = (planId: string, line: BudgetLine): RowRecord => ({
  ...line, planId, age: line.age ?? '', adlScore: line.adlScore ?? '', groupNumber: line.groupNumber ?? '',
  caregiverChanged: String(line.caregiverChanged), excluded: String(line.excluded),
  diaperCount: line.diaperCount ?? '', assessFee: line.assessFee ?? '', reassessFee: line.reassessFee ?? '', teamFee: line.teamFee ?? '', cgMonthly: line.cgMonthly ?? ''
});

const linesOf = (planId: string) => listAll('BudgetLines', (row) => String(row.planId) === planId).map(lineOf);

const BLANK_EDIT: Omit<BudgetLineEdit, 'lineId'> = {
  diapersPerDay: 0, diaperCount: null, otherSupplies: 0, assessFee: null, reassessFee: null, teamFee: null, cgMonthly: null, excluded: false, excludeReason: '', note: ''
};

type Derived = Omit<BudgetLine, keyof BudgetLineEdit>;

function ageOn(birthDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return today.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

/** Each patient's latest confirmed LTC group, across all of their episodes. */
function confirmedGroups(patientOfEpisode: Map<string, string>): Map<string, BudgetGroup> {
  const latest = new Map<string, { at: string; group: BudgetGroup }>();
  for (const row of listAll('LTCClassifications', (candidate) => String(candidate.decisionStatus) === 'CONFIRMED' && patientOfEpisode.has(String(candidate.episodeId)))) {
    const patientId = patientOfEpisode.get(String(row.episodeId))!;
    const group = groupOf(row.groupNumber);
    const at = `${String(row.effectiveAt)}|${String(row.createdAt)}`;
    if (group && (!latest.has(patientId) || at > latest.get(patientId)!.at)) latest.set(patientId, { at, group });
  }
  return new Map([...latest].map(([patientId, { group }]) => [patientId, group]));
}

const allEpisodesByPatient = () => new Map(listAll('CareEpisodes', () => true).map((row) => [String(row.episodeId), String(row.patientId)]));

/** Everyone in care at some point in the fiscal year, as the register shows them today. */
function registerSnapshot(fiscalYear: number): Map<string, Derived> {
  const { from, to } = fiscalYearRange(fiscalYear);
  const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  const episodes = listAll('CareEpisodes', (row) => (dateText(row.startDate) || from) <= to && (dateText(row.endDate) || to) >= from);
  const spansOf = new Map<string, Array<{ startDate: string; endDate: string }>>();
  for (const row of episodes) {
    const spans = spansOf.get(String(row.patientId)) ?? [];
    spans.push({ startDate: dateText(row.startDate), endDate: dateText(row.endDate) });
    spansOf.set(String(row.patientId), spans);
  }
  const yearEpisodes = new Map(episodes.map((row) => [String(row.episodeId), String(row.patientId)]));
  const groups = confirmedGroups(allEpisodesByPatient());

  const adl = new Map<string, { key: string; score: number }>();
  for (const row of listAll('ADLAssessments', (candidate) => String(candidate.status) === 'APPROVED' && yearEpisodes.has(String(candidate.episodeId)))) {
    const patientId = yearEpisodes.get(String(row.episodeId))!;
    const key = `${dateText(row.assessmentDate)}|${String(row.createdAt)}`;
    if (!adl.has(patientId) || key > adl.get(patientId)!.key) adl.set(patientId, { key, score: Number(row.totalScore) });
  }

  // The current caregiver is the active assignment, else the one assigned last in the year.
  const nameOfUser = new Map(listAll('Users', (row) => String(row.role) === 'CG').map((row) => [String(row.userId), String(row.displayName)]));
  const caregivers = new Map<string, { current: string; key: string; staff: Set<string> }>();
  for (const row of listAll('StaffAssignments', (candidate) => String(candidate.role) === 'CG' && yearEpisodes.has(String(candidate.episodeId))
    && (dateText(candidate.dateFrom) || from) <= to && (dateText(candidate.dateTo) || to) >= from)) {
    const patientId = yearEpisodes.get(String(row.episodeId))!;
    const entry = caregivers.get(patientId) ?? { current: '', key: '', staff: new Set<string>() };
    entry.staff.add(String(row.staffId));
    const key = `${String(row.status) === 'ACTIVE' ? 1 : 0}|${dateText(row.dateFrom)}`;
    if (key > entry.key) Object.assign(entry, { key, current: String(row.staffId) });
    caregivers.set(patientId, entry);
  }

  const snapshot = new Map<string, Derived>();
  for (const patient of listAll('Patients', (row) => spansOf.has(String(row.patientId)))) {
    const patientId = String(patient.patientId);
    const coverage = serviceCoverage(fiscalYear, spansOf.get(patientId)!);
    if (coverage.days === 0) continue;
    const caregiver = caregivers.get(patientId);
    snapshot.set(patientId, {
      patientId, fullName: String(patient.fullName), age: ageOn(dateText(patient.birthDate), today),
      address: [String(patient.address ?? '').trim(), String(patient.village ?? '').trim()].filter(Boolean).join(' '),
      adlScore: adl.get(patientId)?.score ?? numberOrNull(patient.adlScore), groupNumber: groups.get(patientId) ?? null,
      serviceFrom: coverage.from, serviceTo: coverage.to, serviceDays: coverage.days, serviceMonths: coverage.months,
      caregiverName: caregiver ? nameOfUser.get(caregiver.current) ?? caregiver.current : '', caregiverChanged: (caregiver?.staff.size ?? 0) > 1
    });
  }
  return snapshot;
}

/** Refreshes the derived fields of the plan's lines and adds people new to the register. */
function pullLines(planId: string, fiscalYear: number): { added: number; updated: number } {
  const snapshot = registerSnapshot(fiscalYear);
  const existing = linesOf(planId);
  const known = new Set(existing.map((line) => line.patientId));
  const lines = existing.map((line) => ({ ...line, ...(snapshot.get(line.patientId) ?? {}) }));
  const added = [...snapshot.values()].filter((derived) => !known.has(derived.patientId))
    .map((derived) => ({ ...BLANK_EDIT, ...derived, lineId: Utilities.getUuid() }));
  replaceRows('BudgetLines', (row) => String(row.planId) === planId, [...lines, ...added].map((line) => rowOfLine(planId, line)));
  return { added: added.length, updated: existing.filter((line) => snapshot.has(line.patientId)).length };
}

function requirePlan(planId: string): RowRecord {
  const plan = getById('BudgetPlans', 'planId', planId);
  if (!plan) throw new Error('BUDGET_PLAN_NOT_FOUND');
  return plan;
}

function requireDraft(planId: string): RowRecord {
  const plan = requirePlan(planId);
  if (String(plan.status) !== 'DRAFT') throw new Error('BUDGET_PLAN_LOCKED');
  return plan;
}

const plansOfYear = (fiscalYear: number) => listAll('BudgetPlans', (row) => Number(row.fiscalYear) === fiscalYear);

function summaryOf(plan: RowRecord, names: Map<string, string>, lineCount: number): BudgetPlanSummary {
  return {
    planId: String(plan.planId), fiscalYear: Number(plan.fiscalYear), version: Number(plan.version), status: String(plan.status) as BudgetPlanStatus,
    approvedAt: String(plan.approvedAt ?? ''), approvedByName: plan.approvedBy ? names.get(String(plan.approvedBy)) ?? String(plan.approvedBy) : '',
    updatedAt: String(plan.updatedAt ?? ''), lineCount
  };
}

const userNames = () => new Map(listAll('Users', () => true).map((row) => [String(row.userId), String(row.displayName)]));

export function listBudgetPlans(actor: Actor): Page<BudgetPlanSummary> {
  requireCapability(actor, 'budget:read');
  ready();
  const counts = new Map<string, number>();
  for (const row of listAll('BudgetLines', () => true)) counts.set(String(row.planId), (counts.get(String(row.planId)) ?? 0) + 1);
  const names = userNames();
  const items = listAll('BudgetPlans', () => true).map((plan) => summaryOf(plan, names, counts.get(String(plan.planId)) ?? 0))
    .sort((left, right) => right.fiscalYear - left.fiscalYear || right.version - left.version);
  return { items, hasMore: false };
}

export function getBudgetPlan(actor: Actor, payload: Record<string, unknown>): BudgetPlanDetail {
  requireCapability(actor, 'budget:read');
  ready();
  const plan = requirePlan(budgetGetSchema.parse(payload).planId);
  const lines = linesOf(String(plan.planId));
  const current = confirmedGroups(allEpisodesByPatient());
  const order = (line: BudgetLine) => line.groupNumber ?? 9;
  return {
    ...summaryOf(plan, userNames(), lines.length),
    settings: settingsOf(plan), approvalNote: String(plan.approvalNote ?? ''), revisionReason: String(plan.revisionReason ?? ''),
    syncedAt: String(plan.syncedAt ?? ''), recordVersion: Number(plan.recordVersion),
    lines: lines.map((line) => ({ ...line, currentGroup: current.get(line.patientId) ?? null }))
      .sort((left, right) => order(left) - order(right) || left.fullName.localeCompare(right.fullName, 'th'))
  };
}

/** A new plan for the year, with last year's settings (rates usually carry over) or the defaults. */
export function createBudgetPlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'budget:manage');
  const { fiscalYear } = budgetCreateSchema.parse(payload);
  ready();
  const planId = Utilities.getUuid();
  const result = withScriptLock(() => {
    if (plansOfYear(fiscalYear).length) throw new Error('BUDGET_PLAN_EXISTS');
    const previous = plansOfYear(fiscalYear - 1).sort((left, right) => Number(right.version) - Number(left.version))[0];
    const settings = previous ? { ...settingsOf(previous), approvedCeiling: null } : DEFAULT_BUDGET_SETTINGS;
    const now = new Date().toISOString();
    appendUnique('BudgetPlans', 'planId', {
      planId, fiscalYear, version: 1, status: 'DRAFT', settingsJson: JSON.stringify(settings), approvedBy: '', approvedAt: '', approvalNote: '', revisionReason: '',
      syncedAt: now, createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
    });
    return pullLines(planId, fiscalYear);
  });
  audit(actor.userId, 'budget.create', 'BudgetPlan', planId, 'SUCCESS', `FY:${fiscalYear}`);
  return { planId, ...result };
}

export function syncBudgetPlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'budget:manage');
  const input = budgetSyncSchema.parse(payload);
  ready();
  const result = withScriptLock(() => {
    const plan = requireDraft(input.planId);
    const saved = versionedUpdate('BudgetPlans', 'planId', input.planId, input.recordVersion, { syncedAt: new Date().toISOString() });
    return { ...pullLines(input.planId, Number(plan.fiscalYear)), recordVersion: Number(saved.recordVersion) };
  });
  audit(actor.userId, 'budget.sync', 'BudgetPlan', input.planId, 'SUCCESS', `ADDED:${result.added}`);
  return { planId: input.planId, ...result };
}

/** Saves the settings and the CM's figures for the lines sent; other lines are left as they are. */
export function saveBudgetPlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'budget:manage');
  const input = budgetSaveSchema.parse(payload);
  ready();
  const recordVersion = withScriptLock(() => {
    requireDraft(input.planId);
    const edits = new Map(input.lines.map((line) => [line.lineId, line]));
    const lines = linesOf(input.planId);
    const ids = new Set(lines.map((line) => line.lineId));
    if (input.lines.some((line) => !ids.has(line.lineId))) throw new Error('BUDGET_LINE_NOT_FOUND');
    const saved = versionedUpdate('BudgetPlans', 'planId', input.planId, input.recordVersion, { settingsJson: JSON.stringify(input.settings) });
    replaceRows('BudgetLines', (row) => String(row.planId) === input.planId,
      lines.map((line) => rowOfLine(input.planId, { ...line, ...(edits.get(line.lineId) ?? {}) })));
    return Number(saved.recordVersion);
  });
  audit(actor.userId, 'budget.save', 'BudgetPlan', input.planId, 'SUCCESS', `LINES:${input.lines.length}`);
  return { planId: input.planId, recordVersion };
}

/** Locks the plan. Refused while the counted costs exceed the ceiling; the old approved version is superseded. */
export function approveBudgetPlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'budget:manage');
  const input = budgetApproveSchema.parse(payload);
  ready();
  const summary = withScriptLock(() => {
    const plan = requireDraft(input.planId);
    const totals = summarizeBudget(settingsOf(plan), linesOf(input.planId));
    if (totals.countedCount === 0) throw new Error('BUDGET_PLAN_EMPTY');
    if (totals.overBudget) throw new Error('BUDGET_OVER_CEILING');
    updateWhere('BudgetPlans', (row) => Number(row.fiscalYear) === Number(plan.fiscalYear) && String(row.status) === 'APPROVED', { status: 'SUPERSEDED' });
    versionedUpdate('BudgetPlans', 'planId', input.planId, input.recordVersion, {
      status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date().toISOString(), approvalNote: input.note
    });
    return totals;
  });
  audit(actor.userId, 'budget.approve', 'BudgetPlan', input.planId, 'SUCCESS', `SPENT:${summary.spent};CEILING:${summary.ceiling}`);
  return { planId: input.planId, status: 'APPROVED', spent: summary.spent, ceiling: summary.ceiling };
}

/** A new draft version copied from the approved plan; the approved one stays in force until the new one is approved. */
export function reviseBudgetPlan(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'budget:manage');
  const input = budgetReviseSchema.parse(payload);
  ready();
  const planId = Utilities.getUuid();
  const version = withScriptLock(() => {
    const plan = requirePlan(input.planId);
    if (String(plan.status) !== 'APPROVED') throw new Error('BUDGET_PLAN_NOT_APPROVED');
    const year = plansOfYear(Number(plan.fiscalYear));
    if (year.some((row) => String(row.status) === 'DRAFT')) throw new Error('BUDGET_DRAFT_EXISTS');
    const next = Math.max(...year.map((row) => Number(row.version) || 0)) + 1;
    const now = new Date().toISOString();
    appendUnique('BudgetPlans', 'planId', {
      planId, fiscalYear: Number(plan.fiscalYear), version: next, status: 'DRAFT', settingsJson: String(plan.settingsJson ?? ''),
      approvedBy: '', approvedAt: '', approvalNote: '', revisionReason: input.reason, syncedAt: String(plan.syncedAt ?? ''),
      createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
    });
    replaceRows('BudgetLines', () => false, linesOf(input.planId).map((line) => rowOfLine(planId, { ...line, lineId: Utilities.getUuid() })));
    return next;
  });
  audit(actor.userId, 'budget.revise', 'BudgetPlan', planId, 'SUCCESS', `FROM:${input.planId}`);
  return { planId, version, status: 'DRAFT' };
}
