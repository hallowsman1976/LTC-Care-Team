import { describe, expect, it } from 'vitest';
import { capabilitiesFor, encounterReviewSchema, schedulePatternSchema } from '../src';

describe('schedule pattern', () => {
  const weekly = { unit: 'WEEK', count: 2, weekdays: [1, 4], windowStart: '09:00', windowEnd: '12:00' } as const;

  it('accepts a weekly pattern whose weekdays match the visit count', () => {
    expect(schedulePatternSchema.safeParse(weekly).success).toBe(true);
  });

  it('rejects weekly counts that the weekdays cannot honour', () => {
    expect(schedulePatternSchema.safeParse({ ...weekly, count: 3 }).success).toBe(false);
    expect(schedulePatternSchema.safeParse({ ...weekly, weekdays: [1, 1] }).success).toBe(false);
  });

  it('rejects inverted windows and incomplete monthly modes', () => {
    expect(schedulePatternSchema.safeParse({ ...weekly, windowStart: '12:00', windowEnd: '09:00' }).success).toBe(false);
    expect(schedulePatternSchema.safeParse({ unit: 'MONTH', count: 1, mode: 'NTH_WEEKDAY', nth: 2, windowStart: '09:00', windowEnd: '10:00' }).success).toBe(false);
    expect(schedulePatternSchema.safeParse({ unit: 'MONTH', count: 1, mode: 'DAY_OF_MONTH', dayOfMonth: 15, windowStart: '09:00', windowEnd: '10:00' }).success).toBe(true);
  });
});

describe('encounter review', () => {
  it('requires a reason when returning work to the caregiver', () => {
    const base = { encounterId: 'enc-1', recordVersion: 1 };
    expect(encounterReviewSchema.safeParse({ ...base, decision: 'RETURNED', reviewNotes: 'short' }).success).toBe(false);
    expect(encounterReviewSchema.safeParse({ ...base, decision: 'VERIFIED' }).success).toBe(true);
  });
});

describe('role capabilities', () => {
  it('returns a copy so callers cannot mutate the shared table', () => {
    const capabilities = capabilitiesFor('CG');
    capabilities.push('export:phi');
    expect(capabilitiesFor('CG')).toEqual(['patients:read']);
  });
});
