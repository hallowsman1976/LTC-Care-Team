export function generationKey(parts: {
  planId: string; version: number; interventionId: string; localDueDate: string; occurrenceNo: number;
}): string {
  const raw = [parts.planId, parts.version, parts.interventionId, parts.localDueDate, parts.occurrenceNo].join('|');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return bytes.map((value) => ((value + 256) % 256).toString(16).padStart(2, '0')).join('');
}

import { appendUnique, getById, listPage } from '../repositories/sheets';

function dueOn(pattern: Record<string, unknown>, date: Date): boolean {
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  if (pattern.unit === 'WEEK') return Array.isArray(pattern.weekdays) && pattern.weekdays.map(Number).includes(weekday);
  if (pattern.unit === 'MONTH' && pattern.mode === 'DAY_OF_MONTH') return date.getDate() === Number(pattern.dayOfMonth);
  if (pattern.unit === 'MONTH' && pattern.mode === 'NTH_WEEKDAY') {
    return weekday === Number(pattern.weekday) && Math.ceil(date.getDate() / 7) === Number(pattern.nth);
  }
  return false;
}

export function runScheduler(): { generated: number; horizonDays: number } {
  const plans = listPage('CarePlans', (row) => String(row.status) === 'ACTIVE', 50);
  let generated = 0;
  for (const plan of plans) {
    const ruleset = getById('ServiceRuleSets', 'rulesetId', String(plan.rulesetId));
    if (!ruleset || String(ruleset.status) !== 'APPROVED') continue;
    const assignments = listPage('StaffAssignments', (row) => String(row.episodeId) === String(plan.episodeId) && String(row.status) === 'ACTIVE', 10);
    const assignee = assignments.find((row) => String(row.role) === 'CG');
    if (!assignee) continue;
    const interventions = listPage('CarePlanInterventions', (row) => String(row.carePlanId) === String(plan.carePlanId), 50);
    for (const intervention of interventions) {
      const pattern = JSON.parse(String(intervention.schedulePatternJson || '{}')) as Record<string, unknown>;
      let occurrenceNo = 0;
      for (let offset = 0; offset < 30; offset += 1) {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() + offset);
        if (!dueOn(pattern, date)) continue;
        occurrenceNo += 1;
        const localDueDate = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
        const key = generationKey({ planId: String(plan.carePlanId), version: Number(plan.version), interventionId: String(intervention.interventionId), localDueDate, occurrenceNo });
        if (getById('VisitSchedules', 'generationKey', key)) continue;
        const start = String(pattern.windowStart ?? '09:00');
        const end = String(pattern.windowEnd ?? '12:00');
        appendUnique('VisitSchedules', 'visitId', {
          visitId: Utilities.getUuid(), episodeId: plan.episodeId, carePlanId: plan.carePlanId,
          interventionId: intervention.interventionId, assignedStaffId: assignee.staffId,
          visitDateTime: `${localDueDate}T${start}:00+07:00`, expectedEndTime: `${localDueDate}T${end}:00+07:00`,
          visitType: intervention.serviceType, status: 'ASSIGNED', generationKey: key, version: 1, rescheduleReason: ''
        });
        generated += 1;
      }
    }
  }
  return { generated, horizonDays: 30 };
}

