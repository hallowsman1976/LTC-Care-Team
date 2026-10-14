import { describe, expect, it } from 'vitest';
import { carePlanCreateSchema } from '@smart-ltc/shared';
import { carePlanSchema, toCarePlanRequest } from './ClinicalForms';

const base = {
  patientId: 'pt-1', rulesetId: 'rs-1', effectiveFrom: '2026-10-01', effectiveTo: '2026-12-31', goalsSummary: 'คงความสามารถในการเคลื่อนไหว',
  serviceType: 'PHYSIO', instructions: 'ฝึกยืนและเดินโดยมีผู้ช่วย', windowStart: '09:00', windowEnd: '11:00'
};

describe('care plan form', () => {
  it('builds a weekly request that satisfies the server contract', () => {
    const request = toCarePlanRequest({ ...base, unit: 'WEEK', weekdays: [4, 1, 4] });
    expect(request.intervention.schedulePattern).toMatchObject({ unit: 'WEEK', count: 2, weekdays: [1, 4] });
    expect(carePlanCreateSchema.safeParse(request).success).toBe(true);
  });

  it('builds a monthly request that satisfies the server contract', () => {
    expect(carePlanCreateSchema.safeParse(toCarePlanRequest({ ...base, unit: 'MONTH', weekdays: [], dayOfMonth: 15 })).success).toBe(true);
  });
});

describe('care plan form validation', () => {
  it('accepts a weekly plan when the hidden day-of-month field was never rendered', () => {
    const result = carePlanSchema.safeParse({ ...base, unit: 'WEEK', weekdays: ['1', '4'] });
    expect(result.success).toBe(true);
  });

  it('treats an empty day-of-month as missing for monthly plans', () => {
    expect(carePlanSchema.safeParse({ ...base, unit: 'MONTH', weekdays: false, dayOfMonth: '' }).success).toBe(false);
    expect(carePlanSchema.safeParse({ ...base, unit: 'MONTH', weekdays: false, dayOfMonth: '15' }).success).toBe(true);
  });
});

describe('ADL form', () => {
  it('describes every score the server accepts, and no others', async () => {
    const { ADL_ITEMS } = await import('./ClinicalForms');
    const { adlAssessmentItemsSchema } = await import('@smart-ltc/shared');
    expect(ADL_ITEMS.map((item) => item.key).sort()).toEqual(Object.keys(adlAssessmentItemsSchema.shape).sort());
    for (const { key, levels } of ADL_ITEMS) {
      const field = adlAssessmentItemsSchema.shape[key];
      levels.forEach((_, score) => expect(field.safeParse(score).success).toBe(true));
      expect(field.safeParse(levels.length).success).toBe(false);
    }
  });
});

describe('LTC classification form', () => {
  it('offers every observation value the server accepts and all four groups', async () => {
    const { OBSERVATION_QUESTIONS, LTC_GROUPS } = await import('./ClinicalForms');
    const { ltcObservationSchema } = await import('@smart-ltc/shared');
    for (const [key, field] of Object.entries(ltcObservationSchema.shape)) {
      const offered = OBSERVATION_QUESTIONS[key as keyof typeof OBSERVATION_QUESTIONS].choices.map((choice) => choice.value).sort();
      expect(offered).toEqual([...field.options].sort());
    }
    expect(LTC_GROUPS.map((group) => group.value)).toEqual([1, 2, 3, 4]);
  });
});
