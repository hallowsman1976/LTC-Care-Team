import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { demoBudgetPlan } from '@smart-ltc/shared';
import { buildXlsx, columnName, crc32 } from '../lib/xlsx';
import { previewRespond } from '../lib/preview';
import { budgetWorkbook, planSubtitle } from './budgetExport';

/** Reads a stored (uncompressed) zip back into name → text. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(crc).toBe(nodeCrc32(data));
    files.set(name, decoder.decode(data));
    at += 30 + nameLength + size;
  }
  return files;
}

describe('xlsx writer', () => {
  it('names columns past Z', () => {
    expect([0, 25, 26, 27, 51, 52].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('computes the zip CRC like zlib', () => {
    const bytes = new TextEncoder().encode('งบประมาณ LTC');
    expect(crc32(bytes)).toBe(nodeCrc32(bytes));
  });

  it('packs a workbook with escaped text, numbers and formulas', () => {
    const files = unzip(buildXlsx([{ name: 'Sheet/1', rows: [['A & <B>', 2, { v: 4, f: 'B1*2', s: 'money' }]], merges: ['A1:C1'] }]));
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
    expect(files.get('xl/workbook.xml')).toContain('name="Sheet 1"');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<t xml:space="preserve">A &amp; &lt;B&gt;</t>');
    expect(sheet).toContain('<c r="B1"><v>2</v></c>');
    expect(sheet).toContain('<c r="C1" s="4"><f>B1*2</f><v>4</v></c>');
    expect(sheet).toContain('<mergeCell ref="A1:C1"/>');
  });
});

describe('budget export', () => {
  const plan = demoBudgetPlan();

  it('lays the plan out in LTC205 columns with totals and a group summary', () => {
    const [main, groups] = budgetWorkbook(plan);
    // Title, subtitle, blank, header, three counted people, the total, then the unclassified one.
    expect(main!.rows[3]![2]).toMatchObject({ v: 'ชื่อ-สกุล' });
    expect(main!.rows.slice(4, 7).map((row) => (row[2] as { v: string }).v)).toEqual(['นายตัวอย่าง หนึ่ง', 'นางตัวอย่าง สอง', 'นายข้อมูลจำลอง สาม']);
    const total = main!.rows[7]!;
    expect(total[17]).toMatchObject({ f: 'SUM(R5:R7)' });
    expect(main!.rows.at(-1)!.map((cell) => (cell as { v: string }).v)).toEqual(['นางรอประเมิน สี่', 'ยังไม่ได้จัดกลุ่ม']);
    expect(groups!.rows[5]).toEqual([{ v: 'รวม', s: 'bold' }, { v: 3, f: 'SUM(B2:B5)', s: 'total' }, { v: null, s: 'cell' }, { v: 14200, f: 'SUM(D2:D5)', s: 'total' }, expect.anything()]);
  });

  it('describes the plan the way the fund\'s form does', () => {
    expect(planSubtitle(plan.settings, plan.lines)).toBe('จำนวน 3 ราย เฉลี่ยรายละ 4,733.33 บาท รวมเป็นเงิน 14,200.00 บาท (ถัวเฉลี่ยได้ตามเกณฑ์ ADL ของผู้ป่วยแต่ละราย)');
  });
});

describe('budget preview routes', () => {
  const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

  it('lets CM manage and ADMIN read budget plans, and hides them from CG', () => {
    expect(previewRespond('/budget-plans', undefined, 'admin').body.data).toMatchObject({ items: [expect.objectContaining({ fiscalYear: 2569 })] });
    expect(previewRespond('/budget-plans', undefined, 'cg').status).toBe(403);
    expect(previewRespond('/budget-plans/get', post({ planId: 'bp-demo-2569' }), 'admin').body.data).toMatchObject({ lines: expect.any(Array) });
    expect(previewRespond('/budget-plans/create', post({ fiscalYear: 2570 }), 'admin').status).toBe(403);
    expect(previewRespond('/budget-plans/create', post({ fiscalYear: 2570 }), 'cm')).toMatchObject({ status: 200, body: { data: { planId: 'bp-demo-2569' } } });
  });
});
