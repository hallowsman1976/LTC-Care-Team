import { describe, expect, it } from 'vitest';
import { parseBloodPressure, STEPS, stepOf } from './VisitRecordForm';

describe('blood pressure entry', () => {
  it('accepts systolic/diastolic with or without the unit', () => {
    expect(parseBloodPressure('110/86')).toEqual({ systolic: 110, diastolic: 86 });
    expect(parseBloodPressure(' 120 / 80 mmHg ')).toEqual({ systolic: 120, diastolic: 80 });
    expect(parseBloodPressure('110')).toBeNull();
    expect(parseBloodPressure('110-86')).toBeNull();
  });
});

describe('form steps', () => {
  it('shows each validation problem on the step that holds the field', () => {
    expect(stepOf('caregiverPhone')).toBe(0);
    expect(stepOf('vitals.diastolic')).toBe(1);
    expect(stepOf('adl')).toBe(2);
    expect(stepOf('q8.canControl')).toBe(3);
    expect(stepOf('signatureImageId')).toBe(5);
    expect(stepOf('urgentFlag')).toBe(STEPS.length - 1);
    expect(stepOf('somethingNew')).toBe(STEPS.length - 1);
  });
});
