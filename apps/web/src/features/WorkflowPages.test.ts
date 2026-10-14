import { describe, expect, it } from 'vitest';
import { formatVisitTime, readVitals } from './WorkflowPages';

describe('review details', () => {
  it('reads vitals and marks values outside the typical range', () => {
    expect(readVitals(JSON.stringify({ temperature: 38.1, pulse: 78 }))).toEqual([
      { label: 'อุณหภูมิ', value: '38.1 °C', outOfRange: true },
      { label: 'ชีพจร', value: '78 ครั้ง/นาที', outOfRange: false }
    ]);
    expect(readVitals(JSON.stringify({ respiration: 24, systolic: 150, diastolic: 85 }))).toEqual([
      { label: 'หายใจ', value: '24 ครั้ง/นาที', outOfRange: true },
      { label: 'ความดันโลหิต', value: '150/85 mmHg', outOfRange: true }
    ]);
    expect(readVitals('{}')).toEqual([]);
    expect(readVitals('not json')).toEqual([]);
  });

  it('shows bare times from older records as they are', () => {
    expect(formatVisitTime('09:05')).toBe('09:05');
    expect(formatVisitTime(undefined)).toBe('–');
    expect(formatVisitTime('2026-10-14T09:05')).not.toBe('2026-10-14T09:05');
  });
});
