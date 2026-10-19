import { describe, expect, it } from 'vitest';
import {
  budgetLineEditSchema, computeBudgetLine, DEFAULT_BUDGET_SETTINGS, fiscalYearOf, fiscalYearRange, serviceCoverage, summarizeBudget,
  type BudgetGroup, type BudgetLine, type BudgetSettings
} from '../src';

const fullYear = { serviceFrom: '2025-10-01', serviceTo: '2026-09-30', serviceDays: 365, serviceMonths: 12 };

const line = (groupNumber: BudgetGroup | null, overrides: Partial<BudgetLine> = {}): BudgetLine => ({
  lineId: 'bl', patientId: 'pt', fullName: 'ผู้ป่วย', age: 80, address: '', adlScore: 5, groupNumber, ...fullYear,
  caregiverName: '', caregiverChanged: false, diapersPerDay: 0, diaperCount: null, otherSupplies: 0,
  assessFee: null, reassessFee: null, teamFee: null, cgMonthly: null, excluded: false, excludeReason: '', note: '', ...overrides
});

describe('fiscal year', () => {
  it('runs from 1 October to 30 September in the Buddhist era', () => {
    expect(fiscalYearRange(2569)).toEqual({ from: '2025-10-01', to: '2026-09-30' });
    expect(fiscalYearOf('2025-10-01')).toBe(2569);
    expect(fiscalYearOf('2026-09-30')).toBe(2569);
    expect(fiscalYearOf('2026-10-19')).toBe(2570);
  });
});

describe('time in care', () => {
  it('counts the whole year for a person in care before it started', () => {
    expect(serviceCoverage(2569, [{ startDate: '2024-05-01', endDate: '' }])).toEqual({ from: '2025-10-01', to: '2026-09-30', days: 365, months: 12 });
  });

  it('counts a month only once 15 of its days were in care', () => {
    // Admitted 17 Oct (15 days of October) and died 14 Mar (14 days of March).
    expect(serviceCoverage(2569, [{ startDate: '2025-10-17', endDate: '2026-03-14' }])).toMatchObject({ days: 149, months: 5 });
    expect(serviceCoverage(2569, [{ startDate: '2025-10-18', endDate: '2026-03-15' }])).toMatchObject({ months: 5 });
  });

  it('merges overlapping episodes and skips gaps', () => {
    const spans = [{ startDate: '2025-10-01', endDate: '2025-12-31' }, { startDate: '2025-12-01', endDate: '2026-01-31' }, { startDate: '2026-06-01', endDate: '' }];
    expect(serviceCoverage(2569, spans)).toMatchObject({ days: 123 + 122, months: 8 });
  });

  it('is empty for a person outside the year', () => {
    expect(serviceCoverage(2569, [{ startDate: '2024-01-01', endDate: '2025-09-30' }])).toEqual({ from: '', to: '', days: 0, months: 0 });
  });
});

describe('budget line', () => {
  const settings: BudgetSettings = { ...DEFAULT_BUDGET_SETTINGS, assessFee: 300, reassessFee: 200, teamFee: 500, cgMonthly: 100 };

  it('adds diapers, supplies, care-plan management and CG pay', () => {
    const figures = computeBudgetLine(settings, line(4, { diapersPerDay: 3, otherSupplies: 120.5 }));
    expect(figures).toMatchObject({ diaperCount: 1095, diaperCost: 10402.5, cpTotal: 1000, cgPay: 1200, total: 12723, groupRate: 10000, difference: -2723, overRate: true });
  });

  it('uses the CM overrides in place of the defaults', () => {
    const figures = computeBudgetLine(settings, line(2, { diapersPerDay: 3, diaperCount: 100, assessFee: 0, cgMonthly: 50 }));
    expect(figures).toMatchObject({ diaperCount: 100, diaperCost: 950, cpTotal: 700, cgPay: 600, total: 2250, groupRate: 4600, overRate: false });
  });

  it('pro-rates the group rate by months in care, in whole baht', () => {
    expect(computeBudgetLine(settings, line(1, { serviceMonths: 5, serviceDays: 150 })).groupRate).toBe(1417);
  });

  it('does not count an unclassified or excluded person', () => {
    expect(computeBudgetLine(settings, line(null)).counted).toBe(false);
    expect(computeBudgetLine(settings, line(3, { excluded: true, excludeReason: 'ย้ายออก' })).counted).toBe(false);
  });

  it('requires a reason to leave a person out', () => {
    const edit = { lineId: 'bl', diapersPerDay: 0, diaperCount: null, otherSupplies: 0, assessFee: null, reassessFee: null, teamFee: null, cgMonthly: null, excluded: true, excludeReason: '', note: '' };
    expect(budgetLineEditSchema.safeParse(edit).success).toBe(false);
    expect(budgetLineEditSchema.safeParse({ ...edit, excludeReason: 'ไม่ใช้สิทธิ์กองทุนนี้' }).success).toBe(true);
  });
});

describe('budget summary', () => {
  // รายละเอียดการใช้งบ LTC_205.xlsx: 8, 11, 1 and 9 people in groups 1–4, 174,000 baht in all.
  const lines = [...Array(8).fill(1), ...Array(11).fill(2), 3, ...Array(9).fill(4)].map((group: BudgetGroup) => line(group));

  it('sums the group rates into the fund ceiling', () => {
    const summary = summarizeBudget(DEFAULT_BUDGET_SETTINGS, lines);
    expect(summary.byGroup.map(({ count, envelope }) => [count, envelope])).toEqual([[8, 27200], [11, 50600], [1, 6200], [9, 90000]]);
    expect(summary).toMatchObject({ envelope: 174000, ceiling: 174000, countedCount: 29, overBudget: false });
  });

  it('pools the budget: one person over their rate is fine while the total fits', () => {
    const pooled = [...lines.slice(1), line(1, { otherSupplies: 5000 })];
    const summary = summarizeBudget(DEFAULT_BUDGET_SETTINGS, pooled);
    expect(summary).toMatchObject({ overRateCount: 1, overBudget: false, spent: 5000, remaining: 169000 });
  });

  it('uses the approved amount as the ceiling when the fund gave one', () => {
    const summary = summarizeBudget({ ...DEFAULT_BUDGET_SETTINGS, approvedCeiling: 3000 }, [line(1, { otherSupplies: 3400 }), line(null)]);
    expect(summary).toMatchObject({ envelope: 3400, ceiling: 3000, overBudget: true, unclassifiedCount: 1 });
  });
});
