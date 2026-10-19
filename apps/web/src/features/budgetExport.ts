import {
  computeBudgetLine, monthsLabel, summarizeBudget,
  type BudgetLine, type BudgetLineFigures, type BudgetPlanDetail, type BudgetSettings
} from '@smart-ltc/shared';
import { columnName, type XlsxCell, type XlsxSheet } from '../lib/xlsx';

// The budget as the fund receives it: LTC205's columns (A–U), with the pro-rated group rate and
// the difference added, then a sheet that sums by group. Money cells carry formulas with their
// values, so the file still adds up when someone edits it.

export const bahtText = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const BUDGET_COLUMNS = [
  'No.', 'รายที่ใช้งบ', 'ชื่อ-สกุล', 'อายุ (ปี)', 'ที่อยู่', 'ADL', 'กลุ่ม', 'จำนวนผ้าอ้อม/วัน', 'จำนวนผ้าอ้อม (ชิ้น)', 'ราคา/ชิ้น',
  'รวมเป็นเงิน (บาท) ค่าผ้าอ้อม', 'วัสดุการแพทย์อื่นๆ', 'ประเมิน/วางแผนให้บริการ', 'ประเมิน/ปรับแผนให้บริการ', 'ค่าตอบแทนทีมบุคลากรสาธารณสุข',
  'รวม ค่าจัดการ CP', 'ค่าตอบแทน CG', 'รวมเงิน', 'หมายเหตุ/อื่นๆ', 'Caregiver', 'ครบ 12 เดือน', 'วงเงินตามกลุ่ม (ตามเดือนที่ดูแล)', 'ส่วนต่าง'
] as const;

export interface PlanRow { line: BudgetLine; figures: BudgetLineFigures }

/** Counted lines in plan order, and the rest (unclassified or left out). */
export function planRows(plan: Pick<BudgetPlanDetail, 'settings' | 'lines'>): { counted: PlanRow[]; others: PlanRow[] } {
  const rows = plan.lines.map((line) => ({ line, figures: computeBudgetLine(plan.settings, line) }));
  return { counted: rows.filter((row) => row.figures.counted), others: rows.filter((row) => !row.figures.counted) };
}

export function planTitle(plan: Pick<BudgetPlanDetail, 'fiscalYear' | 'settings'>): string {
  const source = [plan.settings.fundName, plan.settings.unitName].filter(Boolean).join(' ');
  return `งบประมาณที่ขอรับการสนับสนุน${source ? `จาก${source}` : ''} เป็นค่าใช้จ่ายเพื่อการดูแลผู้ที่มีภาวะพึ่งพิง ปีงบประมาณ ${plan.fiscalYear}`;
}

export function planSubtitle(settings: BudgetSettings, lines: BudgetLine[]): string {
  const summary = summarizeBudget(settings, lines);
  const average = summary.countedCount ? summary.ceiling / summary.countedCount : 0;
  return `จำนวน ${summary.countedCount} ราย เฉลี่ยรายละ ${bahtText(average)} บาท รวมเป็นเงิน ${bahtText(summary.ceiling)} บาท (ถัวเฉลี่ยได้ตามเกณฑ์ ADL ของผู้ป่วยแต่ละราย)`;
}

const money = (v: number, f?: string): XlsxCell => (f ? { v, f, s: 'money' } : { v, s: 'money' });
const text = (v: string | number | null): XlsxCell => ({ v, s: 'cell' });
const centered = (v: string | number | null): XlsxCell => ({ v, s: 'number' });

export function budgetWorkbook(plan: BudgetPlanDetail): XlsxSheet[] {
  const { counted, others } = planRows(plan);
  const summary = summarizeBudget(plan.settings, plan.lines);
  const headerRow = 4;
  const firstRow = headerRow + 1;
  const rows: XlsxCell[][] = [
    [{ v: planTitle(plan), s: 'title' }],
    [{ v: planSubtitle(plan.settings, plan.lines), s: 'title' }],
    [],
    BUDGET_COLUMNS.map((title) => ({ v: title, s: 'head' }))
  ];
  counted.forEach(({ line, figures }, index) => {
    const r = firstRow + index;
    rows.push([
      centered(index + 1), centered(index + 1), text(line.fullName), centered(line.age), text(line.address), centered(line.adlScore), centered(line.groupNumber),
      centered(line.diapersPerDay), centered(figures.diaperCount), money(plan.settings.diaperPrice), money(figures.diaperCost, `I${r}*J${r}`),
      money(figures.otherSupplies), money(figures.assessFee), money(figures.reassessFee), money(figures.teamFee), money(figures.cpTotal, `M${r}+N${r}+O${r}`),
      money(figures.cgPay), money(figures.total, `K${r}+L${r}+P${r}+Q${r}`),
      text([line.note, line.caregiverChanged ? 'เปลี่ยน CG ระหว่างปี' : ''].filter(Boolean).join(' · ')), text(line.caregiverName),
      centered(monthsLabel(line.serviceMonths)), money(figures.groupRate), money(figures.difference, `V${r}-R${r}`)
    ]);
  });
  const lastRow = firstRow + counted.length - 1;
  const sum = (column: string, value: number): XlsxCell => (counted.length ? { v: value, f: `SUM(${column}${firstRow}:${column}${lastRow})`, s: 'total' } : { v: value, s: 'total' });
  const total = (pick: (figures: BudgetLineFigures) => number) => counted.reduce((acc, row) => acc + pick(row.figures), 0);
  const totalRow: XlsxCell[] = Array.from({ length: BUDGET_COLUMNS.length }, () => ({ v: null, s: 'cell' }));
  totalRow[2] = { v: 'รวม', s: 'bold' };
  ([['K', (f) => f.diaperCost], ['L', (f) => f.otherSupplies], ['M', (f) => f.assessFee], ['N', (f) => f.reassessFee], ['O', (f) => f.teamFee],
    ['P', (f) => f.cpTotal], ['Q', (f) => f.cgPay], ['R', (f) => f.total], ['V', (f) => f.groupRate], ['W', (f) => f.difference]] as Array<[string, (f: BudgetLineFigures) => number]>)
    .forEach(([column, pick]) => { totalRow[column.charCodeAt(0) - 65] = sum(column, Math.round(total(pick) * 100) / 100); });
  rows.push(totalRow);
  if (others.length) {
    rows.push([], [{ v: 'ไม่รวมในแผน', s: 'bold' }], [{ v: 'ชื่อ-สกุล', s: 'head' }, { v: 'เหตุผล', s: 'head' }]);
    for (const { line } of others) rows.push([text(line.fullName), text(line.excluded ? line.excludeReason : 'ยังไม่ได้จัดกลุ่ม')]);
  }

  const groupHeader = ['กลุ่ม', 'จำนวน (ราย)', 'อัตรา/ราย/ปี', 'วงเงินตามเดือนที่ดูแล', 'ค่าใช้จ่ายตามแผน'].map((title): XlsxCell => ({ v: title, s: 'head' }));
  const groupRows = summary.byGroup.map((group): XlsxCell[] => [text(`กลุ่ม ${group.group}`), centered(group.count), money(group.rate), money(group.envelope), money(group.spent)]);
  const groupSum = (column: string, value: number): XlsxCell => ({ v: value, f: `SUM(${column}2:${column}5)`, s: 'total' });
  const ceilingRow = summary.ceiling === summary.envelope ? [] : [[{ v: 'วงเงินที่กองทุนอนุมัติ', s: 'bold' }, null, null, money(summary.ceiling)] as XlsxCell[]];
  const groups: XlsxSheet = {
    name: 'สรุปตามกลุ่ม', widths: [26, 14, 16, 22, 20],
    rows: [groupHeader, ...groupRows,
      [{ v: 'รวม', s: 'bold' }, groupSum('B', summary.countedCount), { v: null, s: 'cell' }, groupSum('D', summary.envelope), groupSum('E', summary.spent)],
      [], ...ceilingRow, [{ v: 'คงเหลือ', s: 'bold' }, null, null, money(summary.remaining)]]
  };
  const lastColumn = columnName(BUDGET_COLUMNS.length - 1);
  return [{
    name: `LTC ${plan.fiscalYear}`, rows, merges: [`A1:${lastColumn}1`, `A2:${lastColumn}2`],
    widths: [6, 8, 26, 8, 24, 6, 6, 10, 11, 9, 14, 13, 13, 13, 14, 13, 13, 14, 22, 18, 10, 16, 13]
  }, groups];
}
