import { schedulePatternSchema, type SchedulePattern } from '@smart-ltc/shared';
import { appendUnique, getById, listAll, listPage } from '../repositories/sheets';

const TIME_ZONE = 'Asia/Bangkok';
const HORIZON_DAYS = 30;

/**
 * Idempotency key for one generated visit. It depends only on the plan, intervention and local
 * date, so re-running the job on any day finds the visits it generated earlier.
 */
export function generationKey(parts: { planId: string; version: number; interventionId: string; localDueDate: string }): string {
  const raw = [parts.planId, parts.version, parts.interventionId, parts.localDueDate].join('|');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map((value) => ((value + 256) % 256).toString(16).padStart(2, '0')).join('');
}

interface LocalDay { date: string; isoWeekday: number; dayOfMonth: number }

/** Calendar days in Bangkok starting today, independent of the script's own time zone. */
function upcomingDays(): LocalDay[] {
  const start = Date.now();
  return Array.from({ length: HORIZON_DAYS }, (_, offset) => {
    const instant = new Date(start + offset * 86_400_000);
    return {
      date: Utilities.formatDate(instant, TIME_ZONE, 'yyyy-MM-dd'),
      isoWeekday: Number(Utilities.formatDate(instant, TIME_ZONE, 'u')),
      dayOfMonth: Number(Utilities.formatDate(instant, TIME_ZONE, 'd'))
    };
  });
}

function dueOn(pattern: SchedulePattern, day: LocalDay): boolean {
  if (pattern.unit === 'WEEK') return pattern.weekdays.includes(day.isoWeekday);
  if (pattern.mode === 'DAY_OF_MONTH') return day.dayOfMonth === pattern.dayOfMonth;
  return day.isoWeekday === pattern.weekday && Math.ceil(day.dayOfMonth / 7) === pattern.nth;
}

function parsePattern(json: unknown): SchedulePattern | null {
  try {
    const result = schedulePatternSchema.safeParse(JSON.parse(String(json || 'null')));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function runScheduler(): { generated: number; horizonDays: number; skippedInterventions: number } {
  const days = upcomingDays();
  const plans = listAll('CarePlans', (row) => String(row.status) === 'ACTIVE');
  let generated = 0;
  let skippedInterventions = 0;
  for (const plan of plans) {
    const ruleset = getById('ServiceRuleSets', 'rulesetId', String(plan.rulesetId));
    if (!ruleset || String(ruleset.status) !== 'APPROVED') continue;
    const assignee = listPage('StaffAssignments', (row) =>
      String(row.episodeId) === String(plan.episodeId) && String(row.status) === 'ACTIVE' && String(row.role) === 'CG', 1)[0];
    if (!assignee) continue;
    const from = String(plan.effectiveFrom || '');
    const to = String(plan.effectiveTo || '');
    const interventions = listAll('CarePlanInterventions', (row) => String(row.carePlanId) === String(plan.carePlanId));
    for (const intervention of interventions) {
      const pattern = parsePattern(intervention.schedulePatternJson);
      if (!pattern) { skippedInterventions += 1; continue; }
      for (const day of days) {
        if ((from && day.date < from) || (to && day.date > to) || !dueOn(pattern, day)) continue;
        const key = generationKey({ planId: String(plan.carePlanId), version: Number(plan.version), interventionId: String(intervention.interventionId), localDueDate: day.date });
        if (getById('VisitSchedules', 'generationKey', key)) continue;
        appendUnique('VisitSchedules', 'visitId', {
          visitId: Utilities.getUuid(), episodeId: plan.episodeId, carePlanId: plan.carePlanId,
          interventionId: intervention.interventionId, assignedStaffId: assignee.staffId,
          visitDateTime: `${day.date}T${pattern.windowStart}:00+07:00`, expectedEndTime: `${day.date}T${pattern.windowEnd}:00+07:00`,
          visitType: intervention.serviceType, status: 'ASSIGNED', generationKey: key, version: 1, rescheduleReason: ''
        });
        generated += 1;
      }
    }
  }
  return { generated, horizonDays: HORIZON_DAYS, skippedInterventions };
}
