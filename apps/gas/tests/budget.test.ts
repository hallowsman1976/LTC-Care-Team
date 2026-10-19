import { beforeEach, describe, expect, it } from 'vitest';
import { fakeGas, installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';

type Envelope<T = Record<string, unknown>> = { ok: boolean; code: string; data: T };
const post = <T = Record<string, unknown>>(action: string, subject: string, payload: Record<string, unknown>) => parseOutput(doPost(signedEvent(action, subject, payload))) as Envelope<T>;

interface Line { lineId: string; patientId: string; fullName: string; groupNumber: number | null; currentGroup: number | null; serviceMonths: number; serviceDays: number; caregiverName: string; caregiverChanged: boolean; age: number | null; adlScore: number | null; diapersPerDay: number; otherSupplies: number; excluded: boolean }
interface Plan { planId: string; status: string; version: number; recordVersion: number; settings: Record<string, unknown> & { groupRates: number[] }; lines: Line[] }

const future = new Date(Date.now() + 365 * 86_400_000).toISOString();

beforeEach(() => {
  installFakeGas();
  seed('Users', [
    { userId: 'usr-cm', role: 'CM', enabled: 'true', displayName: 'CM หนึ่ง' },
    { userId: 'usr-admin', role: 'ADMIN', enabled: 'true' },
    { userId: 'usr-cg', role: 'CG', enabled: 'true', displayName: 'CG หนึ่ง' },
    { userId: 'usr-cg2', role: 'CG', enabled: 'true', displayName: 'CG สอง' }
  ]);
  seed('StaffProfiles', [{ staffId: 'st-cm', userId: 'usr-cm', credentialVerifiedAt: '2026-01-01', qualificationExpiry: future }]);
  seed('Patients', [
    { patientId: 'pt-1', fullName: 'นางหนึ่ง', birthDate: '1940-01-15', address: '12', village: 'หมู่ 2 บ้านหนองบัว', status: 'ACTIVE' },
    { patientId: 'pt-2', fullName: 'นายสอง', birthDate: '1950-06-01', address: '3', village: 'หมู่ 4', status: 'DECEASED' },
    { patientId: 'pt-3', fullName: 'นางสาม', birthDate: '1945-02-02', address: '7', village: 'หมู่ 1', status: 'ACTIVE' },
    { patientId: 'pt-old', fullName: 'นายจำหน่ายแล้ว', birthDate: '1930-01-01', address: '1', village: 'หมู่ 1', status: 'DISCHARGED' }
  ]);
  seed('CareEpisodes', [
    { episodeId: 'ep-1', patientId: 'pt-1', startDate: '2024-05-01', endDate: '', status: 'ACTIVE' },
    { episodeId: 'ep-2', patientId: 'pt-2', startDate: '2025-06-01', endDate: '2026-03-14', status: 'CLOSED' },
    { episodeId: 'ep-3', patientId: 'pt-3', startDate: '2026-04-01', endDate: '', status: 'ACTIVE' },
    { episodeId: 'ep-old', patientId: 'pt-old', startDate: '2023-01-01', endDate: '2025-09-30', status: 'CLOSED' }
  ]);
  seed('LTCClassifications', [
    { classId: 'c-1', episodeId: 'ep-1', groupNumber: 2, decisionStatus: 'CONFIRMED', effectiveAt: '2025-01-01T00:00:00.000Z' },
    { classId: 'c-1b', episodeId: 'ep-1', groupNumber: 4, decisionStatus: 'CONFIRMED', effectiveAt: '2025-11-01T00:00:00.000Z' },
    { classId: 'c-2', episodeId: 'ep-2', groupNumber: 1, decisionStatus: 'CONFIRMED', effectiveAt: '2025-06-02T00:00:00.000Z' }
  ]);
  seed('ADLAssessments', [{ assessmentId: 'a-1', episodeId: 'ep-1', assessmentDate: '2025-10-30', totalScore: 3, status: 'APPROVED' }]);
  seed('StaffAssignments', [
    { assignmentId: 's-1', episodeId: 'ep-1', staffId: 'usr-cg2', role: 'CG', dateFrom: '2025-01-01', dateTo: '2025-12-31', status: 'ENDED' },
    { assignmentId: 's-2', episodeId: 'ep-1', staffId: 'usr-cg', role: 'CG', dateFrom: '2026-01-01', dateTo: '', status: 'ACTIVE' }
  ]);
});

const create = () => post<{ planId: string; added: number }>('budget.create', 'usr-cm', { fiscalYear: 2569 });
const getPlan = (planId: string, subject = 'usr-cm') => post<Plan>('budget.get', subject, { planId }).data;
const edit = (line: Line, changes: Record<string, unknown> = {}) => ({
  lineId: line.lineId, diapersPerDay: 0, diaperCount: null, otherSupplies: 0, assessFee: null, reassessFee: null, teamFee: null, cgMonthly: null,
  excluded: false, excludeReason: '', note: '', ...changes
});

describe('budget plans', () => {
  it('pulls everyone in care during the fiscal year with their group, time in care and caregiver', () => {
    const created = create();
    expect(created).toMatchObject({ ok: true, data: { added: 3 } });
    const plan = getPlan(created.data.planId);
    expect(plan).toMatchObject({ status: 'DRAFT', version: 1, settings: { groupRates: [3400, 4600, 6200, 10000], diaperPrice: 9.5 } });
    const byId = Object.fromEntries(plan.lines.map((line) => [line.patientId, line]));
    expect(Object.keys(byId).sort()).toEqual(['pt-1', 'pt-2', 'pt-3']);
    expect(byId['pt-1']).toMatchObject({ groupNumber: 4, serviceMonths: 12, serviceDays: 365, adlScore: 3, caregiverName: 'CG หนึ่ง', caregiverChanged: true, address: '12 หมู่ 2 บ้านหนองบัว' });
    expect(byId['pt-2']).toMatchObject({ groupNumber: 1, serviceMonths: 5, caregiverName: '', caregiverChanged: false });
    expect(byId['pt-3']).toMatchObject({ groupNumber: null, serviceMonths: 6 });
    // Ordered by group, the unclassified last.
    expect(plan.lines.map((line) => line.patientId)).toEqual(['pt-2', 'pt-1', 'pt-3']);
  });

  it('allows one plan per fiscal year, carrying last year\'s rates to the next', () => {
    const first = create().data.planId;
    expect(create()).toMatchObject({ ok: false, code: 'BUDGET_PLAN_EXISTS' });
    const plan = getPlan(first);
    post('budget.save', 'usr-cm', { planId: first, recordVersion: plan.recordVersion, settings: { ...plan.settings, groupRates: [4000, 5000, 7000, 11000], approvedCeiling: 9000 }, lines: [] });
    const next = post<{ planId: string }>('budget.create', 'usr-cm', { fiscalYear: 2570 }).data.planId;
    expect(getPlan(next).settings).toMatchObject({ groupRates: [4000, 5000, 7000, 11000], approvedCeiling: null });
  });

  it('saves the CM\'s figures, keeps them on a re-pull and picks up people new to the register', () => {
    const planId = create().data.planId;
    let plan = getPlan(planId);
    const first = plan.lines.find((line) => line.patientId === 'pt-1')!;
    expect(post('budget.save', 'usr-cm', { planId, recordVersion: plan.recordVersion, settings: plan.settings, lines: [edit(first, { diapersPerDay: 3, otherSupplies: 250.5 })] })).toMatchObject({ ok: true, data: { recordVersion: 2 } });
    expect(post('budget.save', 'usr-cm', { planId, recordVersion: 1, settings: plan.settings, lines: [] })).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    seed('Patients', [{ patientId: 'pt-4', fullName: 'นายสี่', birthDate: '1950-01-01', status: 'ACTIVE' }]);
    seed('CareEpisodes', [{ episodeId: 'ep-4', patientId: 'pt-4', startDate: '2026-09-01', endDate: '', status: 'ACTIVE' }]);
    expect(post('budget.sync', 'usr-cm', { planId, recordVersion: 2 })).toMatchObject({ ok: true, data: { added: 1, updated: 3, recordVersion: 3 } });
    plan = getPlan(planId);
    expect(plan.lines).toHaveLength(4);
    expect(plan.lines.find((line) => line.patientId === 'pt-1')).toMatchObject({ diapersPerDay: 3, otherSupplies: 250.5 });
    expect(records('BudgetLines').filter((row) => row.planId === planId)).toHaveLength(4);
  });

  it('refuses a line from another plan and an exclusion without a reason', () => {
    const planId = create().data.planId;
    const plan = getPlan(planId);
    expect(post('budget.save', 'usr-cm', { planId, recordVersion: 1, settings: plan.settings, lines: [edit(plan.lines[0]!, { lineId: 'bl-other' })] })).toMatchObject({ ok: false, code: 'BUDGET_LINE_NOT_FOUND' });
    expect(post('budget.save', 'usr-cm', { planId, recordVersion: 1, settings: plan.settings, lines: [edit(plan.lines[0]!, { excluded: true })] })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('blocks approval over the ceiling, then locks the approved plan', () => {
    const planId = create().data.planId;
    let plan = getPlan(planId);
    // Group 4 for 12 months (10,000) and group 1 for 5 months (1,417): ceiling 11,417.
    const [second, first] = plan.lines;
    post('budget.save', 'usr-cm', { planId, recordVersion: 1, settings: plan.settings, lines: [edit(first!, { otherSupplies: 9000 }), edit(second!, { otherSupplies: 2500 })] });
    expect(post('budget.approve', 'usr-cm', { planId, recordVersion: 2 })).toMatchObject({ ok: false, code: 'BUDGET_OVER_CEILING' });
    plan = getPlan(planId);
    post('budget.save', 'usr-cm', { planId, recordVersion: 2, settings: plan.settings, lines: [edit(second!, { otherSupplies: 2417 })] });
    expect(post('budget.approve', 'usr-cm', { planId, recordVersion: 3, note: 'ตามมติกองทุน' })).toMatchObject({ ok: true, data: { status: 'APPROVED', spent: 11417, ceiling: 11417 } });
    expect(post('budget.save', 'usr-cm', { planId, recordVersion: 4, settings: plan.settings, lines: [] })).toMatchObject({ ok: false, code: 'BUDGET_PLAN_LOCKED' });
    expect(post('budget.sync', 'usr-cm', { planId, recordVersion: 4 })).toMatchObject({ ok: false, code: 'BUDGET_PLAN_LOCKED' });
  });

  it('revises an approved plan as a new version and supersedes the old one on approval', () => {
    const planId = create().data.planId;
    expect(post('budget.revise', 'usr-cm', { planId, reason: 'ยังไม่อนุมัติ' })).toMatchObject({ ok: false, code: 'BUDGET_PLAN_NOT_APPROVED' });
    post('budget.approve', 'usr-cm', { planId, recordVersion: 1 });
    const revised = post<{ planId: string; version: number }>('budget.revise', 'usr-cm', { planId, reason: 'ผู้ป่วยเปลี่ยนกลุ่ม' });
    expect(revised).toMatchObject({ ok: true, data: { version: 2, status: 'DRAFT' } });
    expect(post('budget.revise', 'usr-cm', { planId, reason: 'ซ้ำอีกครั้ง' })).toMatchObject({ ok: false, code: 'BUDGET_DRAFT_EXISTS' });
    expect(getPlan(revised.data.planId).lines).toHaveLength(3);
    expect(getPlan(planId).status).toBe('APPROVED');
    post('budget.approve', 'usr-cm', { planId: revised.data.planId, recordVersion: 1 });
    const list = post<{ items: Array<{ planId: string; status: string; version: number; approvedByName: string }> }>('budget.list', 'usr-admin', {});
    expect(list.data.items.map(({ version, status }) => [version, status])).toEqual([[2, 'APPROVED'], [1, 'SUPERSEDED']]);
    expect(list.data.items[0]!.approvedByName).toBe('CM หนึ่ง');
  });

  it('flags a line whose confirmed group changed after the pull', () => {
    const planId = create().data.planId;
    seed('LTCClassifications', [{ classId: 'c-3', episodeId: 'ep-3', groupNumber: 3, decisionStatus: 'CONFIRMED', effectiveAt: '2026-05-01T00:00:00.000Z' }]);
    expect(getPlan(planId).lines.find((line) => line.patientId === 'pt-3')).toMatchObject({ groupNumber: null, currentGroup: 3 });
  });

  it('lets ADMIN read plans but only CM change them, and hides plans from CG', () => {
    const planId = create().data.planId;
    expect(getPlan(planId, 'usr-admin').lines).toHaveLength(3);
    expect(post('budget.create', 'usr-admin', { fiscalYear: 2570 })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(post('budget.approve', 'usr-admin', { planId, recordVersion: 1 })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(post('budget.list', 'usr-cg', {})).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(fakeGas.lockDepth).toBe(0);
  });
});
