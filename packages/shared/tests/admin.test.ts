import { describe, expect, it } from 'vitest';
import { caregiverCreateSchema, dependencyFromAdl, importTemplateCsv, patientCreateSchema, normalizeBirthDate, parseCsv, readImportCsv } from '../src';

const header = 'รหัสท้องถิ่น,HN,เลขประจำตัวประชาชน,ชื่อ-สกุล,วันเกิด,เพศ,ที่อยู่,หมู่บ้าน,โทรศัพท์';

describe('patient form', () => {
  const base = { hn: 'HN-1', cid: '1100000000002', fullName: 'นางสมมติ', birthDate: '1945-03-15', sex: 'FEMALE', address: '12/3' };

  it('treats empty optional inputs as absent and reads numbers typed as text', () => {
    const parsed = patientCreateSchema.parse({ ...base, relationship: '', rightType: '', adlScore: '', ppsScore: '50', latitude: '16.4321', mainCaregiverPhone: '089-999 9999' });
    expect(parsed).toMatchObject({ localCode: '', relationship: undefined, adlScore: undefined, ppsScore: 50, latitude: 16.4321, mainCaregiverPhone: '0899999999' });
  });

  it('rejects out-of-range scores and coordinates', () => {
    for (const change of [{ adlScore: 21 }, { ppsScore: 55 }, { latitude: 91 }, { taiGroup: 'X9' }, { villageNo: 'สอง' }]) {
      expect(patientCreateSchema.safeParse({ ...base, ...change }).success).toBe(false);
    }
  });

  it('suggests the dependency group from the ADL score', () => {
    expect([20, 12, 11, 5, 4, 0].map(dependencyFromAdl)).toEqual(['SOCIAL', 'SOCIAL', 'HOMEBOUND', 'HOMEBOUND', 'BEDBOUND', 'BEDBOUND']);
  });
});

describe('caregiver form', () => {
  const valid = {
    displayName: 'CG สมมติ', username: 'CG.New', password: 'long enough password', cid: '1100000000002', birthDate: '1980-05-01', phone: '081-234 5678',
    address: '12 ม.2 ต.ทดสอบ', email: '', education: 'BACHELOR', organization: { name: 'รพ.สต. ทดสอบ', type: 'HOSPITAL', serviceArea: '' },
    trainings: [{ course: 'หลักสูตร 70 ชั่วโมง', provider: '', completedOn: '2024-06-30' }]
  };

  it('normalizes the username and phone number', () => {
    expect(caregiverCreateSchema.parse(valid)).toMatchObject({ username: 'cg.new', phone: '0812345678' });
  });

  it('rejects bad CIDs, phones, future dates and unknown choices', () => {
    for (const change of [{ cid: '123' }, { phone: '812345678' }, { birthDate: '2999-01-01' }, { education: 'NONE' }, { email: 'not-an-email' }]) {
      expect(caregiverCreateSchema.safeParse({ ...valid, ...change }).success).toBe(false);
    }
  });
});

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
