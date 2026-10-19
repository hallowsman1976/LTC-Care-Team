import { z } from 'zod';

// LTC budget plans: what a unit asks its local health fund (กองทุนหลักประกันสุขภาพตำบล) for, per
// fiscal year. The fund pays a yearly rate per dependent person by LTC group, pooled across the
// unit (ถัวเฉลี่ย), so the ceiling is the sum of every counted person's group rate. The same
// functions run in the browser (as the CM types) and in GAS (before approval).

export const BUDGET_GROUPS = [1, 2, 3, 4] as const;
export type BudgetGroup = (typeof BUDGET_GROUPS)[number];

export const BUDGET_PLAN_STATUSES = ['DRAFT', 'APPROVED', 'SUPERSEDED'] as const;
export type BudgetPlanStatus = (typeof BUDGET_PLAN_STATUSES)[number];
export const BUDGET_STATUS_LABELS: Record<BudgetPlanStatus, string> = { DRAFT: 'ร่าง', APPROVED: 'อนุมัติแล้ว', SUPERSEDED: 'ฉบับเดิม (มีฉบับปรับปรุง)' };

/** A month counts toward pro-rating once the person was in care for this many of its days. */
export const MIN_DAYS_FOR_MONTH = 15;

const money = z.number({ invalid_type_error: 'ระบุเป็นตัวเลข' }).min(0, 'ต้องไม่ติดลบ').max(10_000_000);
const optionalMoney = money.nullable();

export const budgetSettingsSchema = z.object({
  fundName: z.string().trim().max(200),
  unitName: z.string().trim().max(200),
  /** Yearly rate per person for groups 1–4. */
  groupRates: z.tuple([money, money, money, money]),
  diaperPrice: money,
  /** Per-person defaults for ประเมิน/วางแผน (M), ประเมิน/ปรับแผน (N) and the health team (O). */
  assessFee: money,
  reassessFee: money,
  teamFee: money,
  /** CG pay per month in care (Q). */
  cgMonthly: money,
  /** What the fund actually approved; when set it replaces the computed ceiling. */
  approvedCeiling: optionalMoney
});
export type BudgetSettings = z.infer<typeof budgetSettingsSchema>;

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  fundName: '', unitName: '', groupRates: [3400, 4600, 6200, 10000], diaperPrice: 9.5,
  assessFee: 0, reassessFee: 0, teamFee: 0, cgMonthly: 0, approvedCeiling: null
};

/** What the CM types per person. A null override means "use the plan's default". */
export const budgetLineEditSchema = z.object({
  lineId: z.string().trim().min(1).max(80),
  diapersPerDay: z.number({ invalid_type_error: 'ระบุเป็นตัวเลข' }).int('ระบุเป็นจำนวนเต็ม').min(0).max(20),
  diaperCount: z.number().int().min(0).max(100_000).nullable(),
  otherSupplies: money,
  assessFee: optionalMoney,
  reassessFee: optionalMoney,
  teamFee: optionalMoney,
  cgMonthly: optionalMoney,
  excluded: z.boolean(),
  excludeReason: z.string().trim().max(300),
  note: z.string().trim().max(300)
}).refine((line) => !line.excluded || line.excludeReason.length >= 5, { path: ['excludeReason'], message: 'ระบุเหตุผลที่ไม่รวมในแผน' });
export type BudgetLineEdit = z.infer<typeof budgetLineEditSchema>;

/** A line as stored: the CM's edits plus what the server derived from the register. */
export interface BudgetLine extends BudgetLineEdit {
  patientId: string;
  fullName: string;
  age: number | null;
  address: string;
  adlScore: number | null;
  /** The confirmed group when the line was last pulled; null while unclassified. */
  groupNumber: BudgetGroup | null;
  serviceFrom: string;
  serviceTo: string;
  serviceDays: number;
  serviceMonths: number;
  caregiverName: string;
  caregiverChanged: boolean;
}

const entityId = z.string().trim().min(1).max(80);
const planVersion = z.number().int().min(1);

export const budgetCreateSchema = z.object({ fiscalYear: z.number().int().min(2560).max(2700) });
export const budgetGetSchema = z.object({ planId: entityId });
export const budgetSyncSchema = z.object({ planId: entityId, recordVersion: planVersion });
export const budgetSaveSchema = z.object({
  planId: entityId, recordVersion: planVersion,
  settings: budgetSettingsSchema,
  lines: z.array(budgetLineEditSchema).max(1000)
});
export const budgetApproveSchema = z.object({ planId: entityId, recordVersion: planVersion, note: z.string().trim().max(500).default('') });
export const budgetReviseSchema = z.object({ planId: entityId, reason: z.string().trim().min(5, 'ระบุเหตุผลที่ปรับปรุงแผน').max(500) });

export interface BudgetPlanSummary {
  planId: string; fiscalYear: number; version: number; status: BudgetPlanStatus;
  approvedAt: string; approvedByName: string; updatedAt: string; lineCount: number;
}

export interface BudgetPlanDetail extends BudgetPlanSummary {
  settings: BudgetSettings;
  approvalNote: string;
  revisionReason: string;
  syncedAt: string;
  recordVersion: number;
  /** `currentGroup` is the confirmed group now, to flag lines whose group changed since the pull. */
  lines: Array<BudgetLine & { currentGroup: BudgetGroup | null }>;
}

// ── Fiscal year and time in care ────────────────────────────────────────────────────────────

/** Thai fiscal year (พ.ศ.) N runs from 1 October of N-544 to 30 September of N-543 (C.E.). */
export function fiscalYearRange(fiscalYear: number): { from: string; to: string } {
  const year = fiscalYear - 543;
  return { from: `${year - 1}-10-01`, to: `${year}-09-30` };
}

/** The fiscal year (พ.ศ.) that an ISO date falls in. */
export function fiscalYearOf(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  return (Number(isoDate.slice(5, 7)) >= 10 ? year + 1 : year) + 543;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS);
const isoOfDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export interface CareSpan { startDate: string; endDate: string }

/**
 * Days and months in care within the fiscal year, from the person's care episodes (which may
 * overlap or leave gaps). A blank start means before the year; a blank end means still in care.
 */
export function serviceCoverage(fiscalYear: number, spans: CareSpan[]): { from: string; to: string; days: number; months: number } {
  const range = fiscalYearRange(fiscalYear);
  const first = dayNumber(range.from);
  const last = dayNumber(range.to);
  const covered = new Set<number>();
  for (const span of spans) {
    const start = Math.max(first, /^\d{4}-\d{2}-\d{2}/.test(span.startDate) ? dayNumber(span.startDate) : first);
    const end = Math.min(last, /^\d{4}-\d{2}-\d{2}/.test(span.endDate) ? dayNumber(span.endDate) : last);
    for (let day = start; day <= end; day += 1) covered.add(day);
  }
  if (covered.size === 0) return { from: '', to: '', days: 0, months: 0 };
  const perMonth = new Map<string, number>();
  for (const day of covered) {
    const month = isoOfDay(day).slice(0, 7);
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }
  const months = [...perMonth.values()].filter((days) => days >= MIN_DAYS_FOR_MONTH).length;
  const days = [...covered];
  return { from: isoOfDay(Math.min(...days)), to: isoOfDay(Math.max(...days)), days: covered.size, months };
}

// ── Money ───────────────────────────────────────────────────────────────────────────────────

/** Baht with satang: rounding each figure once keeps sums free of float noise. */
export const roundSatang = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** The yearly rate for a group. */
export const groupRateOf = (settings: BudgetSettings, group: BudgetGroup) => settings.groupRates[group - 1] ?? 0;

export interface BudgetLineFigures {
  /** Counted toward the plan: classified and not excluded. */
  counted: boolean;
  diaperCount: number;
  diaperCost: number;   // K
  otherSupplies: number; // L
  assessFee: number;    // M
  reassessFee: number;  // N
  teamFee: number;      // O
  cpTotal: number;      // P = M + N + O
  cgPay: number;        // Q
  total: number;        // R = K + L + P + Q
  /** The group rate pro-rated by months in care, in whole baht. */
  groupRate: number;
  /** groupRate − total; negative when the person's costs exceed their group rate. */
  difference: number;
  overRate: boolean;
}

export function computeBudgetLine(settings: BudgetSettings, line: BudgetLine): BudgetLineFigures {
  const counted = line.groupNumber !== null && !line.excluded;
  const diaperCount = line.diaperCount ?? line.diapersPerDay * line.serviceDays;
  const diaperCost = roundSatang(diaperCount * settings.diaperPrice);
  const otherSupplies = roundSatang(line.otherSupplies);
  const assessFee = roundSatang(line.assessFee ?? settings.assessFee);
  const reassessFee = roundSatang(line.reassessFee ?? settings.reassessFee);
  const teamFee = roundSatang(line.teamFee ?? settings.teamFee);
  const cpTotal = roundSatang(assessFee + reassessFee + teamFee);
  const cgPay = roundSatang((line.cgMonthly ?? settings.cgMonthly) * line.serviceMonths);
  const total = roundSatang(diaperCost + otherSupplies + cpTotal + cgPay);
  const groupRate = line.groupNumber === null ? 0 : Math.round((groupRateOf(settings, line.groupNumber) * line.serviceMonths) / 12);
  const difference = roundSatang(groupRate - total);
  return { counted, diaperCount, diaperCost, otherSupplies, assessFee, reassessFee, teamFee, cpTotal, cgPay, total, groupRate, difference, overRate: counted && difference < 0 };
}

export interface BudgetSummary {
  byGroup: Array<{ group: BudgetGroup; count: number; rate: number; envelope: number; spent: number }>;
  /** Sum of counted people's pro-rated group rates. */
  envelope: number;
  /** The fund's approved amount when given, otherwise the envelope. */
  ceiling: number;
  spent: number;
  remaining: number;
  overBudget: boolean;
  countedCount: number;
  unclassifiedCount: number;
  excludedCount: number;
  overRateCount: number;
}

export function summarizeBudget(settings: BudgetSettings, lines: BudgetLine[]): BudgetSummary {
  const figures = lines.map((line) => ({ line, figures: computeBudgetLine(settings, line) }));
  const counted = figures.filter(({ figures: item }) => item.counted);
  const byGroup = BUDGET_GROUPS.map((group) => {
    const members = counted.filter(({ line }) => line.groupNumber === group);
    return {
      group, count: members.length, rate: groupRateOf(settings, group),
      envelope: members.reduce((sum, { figures: item }) => sum + item.groupRate, 0),
      spent: roundSatang(members.reduce((sum, { figures: item }) => sum + item.total, 0))
    };
  });
  const envelope = byGroup.reduce((sum, group) => sum + group.envelope, 0);
  const ceiling = settings.approvedCeiling ?? envelope;
  const spent = roundSatang(byGroup.reduce((sum, group) => sum + group.spent, 0));
  return {
    byGroup, envelope, ceiling, spent, remaining: roundSatang(ceiling - spent), overBudget: spent > ceiling,
    countedCount: counted.length,
    unclassifiedCount: lines.filter((line) => line.groupNumber === null && !line.excluded).length,
    excludedCount: lines.filter((line) => line.excluded).length,
    overRateCount: counted.filter(({ figures: item }) => item.overRate).length
  };
}

/** The ครบ 12 เดือน column: "ครบ", or the months in care. */
export const monthsLabel = (months: number) => (months >= 12 ? 'ครบ' : `${months} เดือน`);
