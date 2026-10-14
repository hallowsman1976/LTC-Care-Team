import { describe, expect, it } from 'vitest';
import { importTemplateCsv, normalizeBirthDate, parseCsv, readImportCsv } from '../src';

const header = 'รหัสท้องถิ่น,HN,เลขประจำตัวประชาชน,ชื่อ-สกุล,วันเกิด,เพศ,ที่อยู่,หมู่บ้าน,โทรศัพท์';

describe('import CSV', () => {
  it('parses quoted fields with commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","d ""e""\nf"\r\n1,2,3')).toEqual([['a', 'b, c', 'd "e"\nf'], ['1', '2', '3']]);
  });

  it('accepts Buddhist and Christian era dates and rejects impossible ones', () => {
    expect(normalizeBirthDate('15/03/2485')).toBe('1942-03-15');
    expect(normalizeBirthDate('1942-3-15')).toBe('1942-03-15');
    expect(normalizeBirthDate('31/02/2485')).toBeNull();
    expect(normalizeBirthDate('15-03')).toBeNull();
  });

  it('skips the template example row and reads a filled-in row', () => {
    const csv = `﻿${importTemplateCsv()}ท-01,HN-1,1100000000001,นางสมใจ ทดสอบ,15/03/2485,หญิง,"12 ม.2, ต.ทดสอบ",หมู่ 2,081 234 5678\r\n`;
    const preview = readImportCsv(csv);
    expect(preview.missingColumns).toEqual([]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ line: 3, errors: [], row: { hn: 'HN-1', birthDate: '1942-03-15', sex: 'FEMALE', address: '12 ม.2, ต.ทดสอบ', phone: '0812345678' } });
  });

  it('explains rows that cannot be imported, including Excel-mangled CIDs and duplicates', () => {
    const preview = readImportCsv([header,
      'ท-01,HN-1,1.1E+12,นาย ก,01/01/2480,ชาย,บ้าน,,',
      'ท-02,HN-2,1100000000002,นาย ข,99/99/2480,ชาย,บ้าน,,',
      'ท-03,HN-3,1100000000003,นาย ค,01/01/2480,ชาย,บ้าน,,',
      'ท-04,hn-3,1100000000004,นาย ง,01/01/2480,ชาย,บ้าน,,'
    ].join('\n'));
    expect(preview.rows.map((row) => row.row === null)).toEqual([true, true, false, true]);
    expect(preview.rows[0]!.errors.join()).toContain('วิทยาศาสตร์');
    expect(preview.rows[1]!.errors.join()).toContain('วันเกิด');
    expect(preview.rows[3]!.errors.join()).toContain('บรรทัด 4');
  });

  it('reports missing required columns', () => {
    expect(readImportCsv('ชื่อ-สกุล,HN\nก,1').missingColumns).toEqual(['รหัสท้องถิ่น', 'เลขประจำตัวประชาชน', 'วันเกิด', 'ที่อยู่']);
  });
});
