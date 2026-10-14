import { describe, expect, it } from 'vitest';
import { parseBloodPressure } from './VisitRecordForm';

describe('blood pressure entry', () => {
  it('accepts systolic/diastolic with or without the unit', () => {
    expect(parseBloodPressure('110/86')).toEqual({ systolic: 110, diastolic: 86 });
    expect(parseBloodPressure(' 120 / 80 mmHg ')).toEqual({ systolic: 120, diastolic: 80 });
    expect(parseBloodPressure('110')).toBeNull();
    expect(parseBloodPressure('110-86')).toBeNull();
  });
});
