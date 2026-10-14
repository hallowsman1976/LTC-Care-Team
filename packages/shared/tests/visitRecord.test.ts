import { describe, expect, it } from 'vitest';
import {
  calculateBmi, formatThaiDate, interpretBmi, interpretQ8, interpretQ9, mentalHealthAlert, needsSuicideAssessment,
  scoreQ8, visitRecordSubmitSchema
} from '../src';

const valid = {
  visitId: 'vs-1', submissionId: '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b', visitDate: '2026-10-14', startTime: '09:00', endTime: '10:00',
  caregiverName: 'สมหญิง ใจดี', caregiverRelation: 'บุตร', caregiverPhone: '0812345678',
  weightKg: 55, heightCm: 160, vitals: { temperature: 36.8, pulse: 78, respiration: 18, systolic: 120, diastolic: 80 },
  adl: { feeding: 2, grooming: 1, transfer: 3, toiletUse: 2, mobility: 3, dressing: 2, stairs: 2, bathing: 1, bowels: 2, bladder: 2 },
  q2: [false, false], dailyCare: [], basicHealth: [], otherCare: [],
  olderImageId: 'img-1', serviceImageId: 'img-2', signatureImageId: 'img-3', urgentFlag: false, notes: ''
};

describe('visit record scoring', () => {
  it('computes and interprets BMI with Asia-Pacific cut-offs', () => {
    expect(calculateBmi(55, 160)).toBe(21.5);
    expect([18.4, 18.5, 22.9, 23, 24.9, 25, 29.9, 30].map(interpretBmi)).toEqual([
      'น้ำหนักน้อยกว่าเกณฑ์', 'ปกติ', 'ปกติ', 'น้ำหนักเกิน', 'น้ำหนักเกิน', 'อ้วนระดับ 1', 'อ้วนระดับ 1', 'อ้วนระดับ 2'
    ]);
  });

  it('interprets 9Q and 8Q at every boundary', () => {
    expect([0, 6, 7, 12, 13, 18, 19, 27].map(interpretQ9)).toEqual([
      'ไม่มีภาวะซึมเศร้า', 'ไม่มีภาวะซึมเศร้า', 'มีภาวะซึมเศร้าระดับน้อย', 'มีภาวะซึมเศร้าระดับน้อย',
      'มีภาวะซึมเศร้าระดับปานกลาง', 'มีภาวะซึมเศร้าระดับปานกลาง', 'มีภาวะซึมเศร้าระดับรุนแรง', 'มีภาวะซึมเศร้าระดับรุนแรง'
    ]);
    expect([0, 1, 8, 9, 16, 17].map(interpretQ8)).toEqual([
      'ไม่มีแนวโน้มฆ่าตัวตายในปัจจุบัน', 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับน้อย', 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับน้อย',
      'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับกลาง', 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับกลาง', 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับรุนแรง'
    ]);
    expect(needsSuicideAssessment([1, 1, 1, 1, 1, 1, 0, 0, 0])).toBe(false);
    expect(needsSuicideAssessment([1, 1, 1, 1, 1, 1, 1, 0, 0])).toBe(true);
  });

  it('scores 8Q with the follow-up only when the suicidal thought cannot be controlled', () => {
    const all = Array(8).fill(true);
    expect(scoreQ8(all, true)).toBe(44);
    expect(scoreQ8(all, false)).toBe(52);
    expect(scoreQ8([false, false, false, false, false, false, false, false], false)).toBe(0);
    expect(mentalHealthAlert({ q8: { answers: [true, false, false, false, false, false, false, false] } })).toEqual({ severity: 'MEDIUM' });
    expect(mentalHealthAlert({ q8: { answers: [false, false, true, false, false, false, false, false], canControl: false } })).toEqual({ severity: 'MEDIUM' });
    expect(mentalHealthAlert({ q8: { answers: [false, false, true, true, false, false, false, false], canControl: false } })).toEqual({ severity: 'HIGH' });
    expect(mentalHealthAlert({ q9: [0, 0, 0, 0, 0, 0, 0, 0, 1] })).toEqual({ severity: 'MEDIUM' });
    expect(mentalHealthAlert({ q9: [0, 0, 0, 0, 0, 0, 0, 0, 0] })).toBeNull();
  });

  it('formats dates as dd/MM/yyyy in the Buddhist year', () => {
    expect(formatThaiDate('2026-10-04')).toBe('04/10/2569');
  });
});

describe('visit record contract', () => {
  it('accepts a complete record with a negative 2Q screen', () => {
    expect(visitRecordSubmitSchema.safeParse(valid).success).toBe(true);
  });

  it('requires 9Q only after a positive 2Q, and 8Q only when 9Q is 7 or more', () => {
    const issues = (record: object) => visitRecordSubmitSchema.safeParse(record).error?.issues.map((issue) => issue.message) ?? [];
    expect(issues({ ...valid, q2: [true, false] })).toContain('Q9_REQUIRED');
    expect(issues({ ...valid, q9: Array(9).fill(0) })).toContain('Q9_NOT_EXPECTED');
    const highQ9 = { ...valid, q2: [true, true], q9: [1, 1, 1, 1, 1, 1, 1, 0, 0] };
    expect(issues(highQ9)).toContain('Q8_REQUIRED');
    expect(issues({ ...highQ9, q8: { answers: [false, false, true, false, false, false, false, false] } })).toContain('Q8_FOLLOW_UP_REQUIRED');
    expect(issues({ ...highQ9, q8: { answers: Array(8).fill(false) } })).toEqual([]);
  });

  it('rejects bad phone numbers, reversed times and impossible blood pressure', () => {
    const fails = (record: object) => !visitRecordSubmitSchema.safeParse(record).success;
    expect(fails({ ...valid, caregiverPhone: '081-234-5678' })).toBe(true);
    expect(fails({ ...valid, caregiverPhone: '812345678' })).toBe(true);
    expect(fails({ ...valid, endTime: '08:59' })).toBe(true);
    expect(fails({ ...valid, vitals: { ...valid.vitals, systolic: 80, diastolic: 90 } })).toBe(true);
  });
});
