import { describe, expect, it } from 'vitest';
import { formatThaiDate, fromIsoDate, parseThaiDate, toIsoDate } from './thaiDate';

describe('Thai Buddhist-era dates', () => {
  it('shows the stored ISO date with a Thai month and พ.ศ. year', () => {
    expect(formatThaiDate(fromIsoDate('1985-04-12')!)).toBe('12 เมษายน 2528');
  });

  it('reads typed dates in พ.ศ. or ค.ศ. and keeps the calendar day', () => {
    expect(toIsoDate(parseThaiDate('12/04/2528')!)).toBe('1985-04-12');
    expect(toIsoDate(parseThaiDate('1-2-1950')!)).toBe('1950-02-01');
    expect(toIsoDate(parseThaiDate('12 เมษายน 2528')!)).toBe('1985-04-12');
    expect(toIsoDate(parseThaiDate('12 เม 2528')!)).toBe('1985-04-12');
  });

  it('rejects impossible dates and two-digit years', () => {
    expect(parseThaiDate('31/02/2528')).toBeNull();
    expect(parseThaiDate('12/04/28')).toBeNull();
    expect(fromIsoDate('2024-02-30')).toBeNull();
  });
});
