import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { monthsLabel, summarizeBudget, type BudgetPlanDetail } from '@smart-ltc/shared';
import { post } from '../lib/api';
import { ErrorState, Loading } from '../components/ui';
import { BUDGET_COLUMNS, bahtText, planRows, planSubtitle, planTitle } from './budgetExport';

// The plan on A4 landscape in LTC205's layout, for printing or saving as PDF from the browser.
// It shows what is saved; a draft is marked as such on every page.

const cell = 'border border-slate-400 px-1 py-0.5 align-top';
const num = `${cell} text-right tabular-nums`;

export function BudgetPrint() {
  const { planId = '' } = useParams();
  const plan = useQuery({ queryKey: ['budget', 'plan', planId], queryFn: () => post<BudgetPlanDetail>('/budget-plans/get', { planId }) });
  if (plan.isLoading) return <Loading/>;
  if (plan.error || !plan.data) return <main className="p-6"><ErrorState message={plan.error?.message ?? 'ไม่พบแผน'}/></main>;
  const data = plan.data;
  const { counted, others } = planRows(data);
  const summary = summarizeBudget(data.settings, data.lines);
  const sum = (pick: (row: typeof counted[number]) => number) => bahtText(counted.reduce((total, row) => total + pick(row), 0));

  return <main className="bg-white p-4 text-[11px] leading-tight text-black print:p-0">
    <style>{'@page { size: A4 landscape; margin: 10mm; } @media print { body { background: #fff; } }'}</style>
    <div className="mb-3 flex items-center justify-between gap-2 print:hidden">
      <p className="text-sm text-slate-600">ตั้งค่าการพิมพ์: กระดาษ A4 แนวนอน · เลือก “บันทึกเป็น PDF” เพื่อเก็บเป็นไฟล์</p>
      <button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl bg-primary px-4 font-semibold text-white">พิมพ์ / บันทึก PDF</button>
    </div>
    {data.status === 'DRAFT' && <p className="mb-1 text-center text-sm font-bold text-red-700">ฉบับร่าง — ยังไม่ได้อนุมัติ</p>}
    <h1 className="text-center text-sm font-bold">{planTitle(data)}</h1>
    <p className="mb-2 text-center">{planSubtitle(data.settings, data.lines)} · ฉบับที่ {data.version}</p>
    <table className="w-full border-collapse">
      <thead className="bg-sky-50"><tr>{BUDGET_COLUMNS.map((title) => <th key={title} className={`${cell} font-semibold`}>{title}</th>)}</tr></thead>
      <tbody>
        {counted.map(({ line, figures }, index) => <tr key={line.lineId} className="break-inside-avoid">
          <td className={num}>{index + 1}</td><td className={num}>{index + 1}</td><td className={cell}>{line.fullName}</td><td className={num}>{line.age ?? ''}</td>
          <td className={cell}>{line.address}</td><td className={num}>{line.adlScore ?? ''}</td><td className={num}>{line.groupNumber}</td>
          <td className={num}>{line.diapersPerDay || ''}</td><td className={num}>{figures.diaperCount || ''}</td><td className={num}>{bahtText(data.settings.diaperPrice)}</td>
          <td className={num}>{bahtText(figures.diaperCost)}</td><td className={num}>{bahtText(figures.otherSupplies)}</td><td className={num}>{bahtText(figures.assessFee)}</td>
          <td className={num}>{bahtText(figures.reassessFee)}</td><td className={num}>{bahtText(figures.teamFee)}</td><td className={num}>{bahtText(figures.cpTotal)}</td>
          <td className={num}>{bahtText(figures.cgPay)}</td><td className={`${num} font-semibold`}>{bahtText(figures.total)}</td>
          <td className={cell}>{[line.note, line.caregiverChanged ? 'เปลี่ยน CG ระหว่างปี' : ''].filter(Boolean).join(' · ')}</td><td className={cell}>{line.caregiverName}</td>
          <td className={`${cell} text-center`}>{monthsLabel(line.serviceMonths)}</td><td className={num}>{bahtText(figures.groupRate)}</td><td className={num}>{bahtText(figures.difference)}</td>
        </tr>)}
      </tbody>
      <tfoot className="font-bold"><tr>
        <td className={cell} colSpan={10}>รวม</td>
        <td className={num}>{sum((row) => row.figures.diaperCost)}</td><td className={num}>{sum((row) => row.figures.otherSupplies)}</td><td className={num}>{sum((row) => row.figures.assessFee)}</td>
        <td className={num}>{sum((row) => row.figures.reassessFee)}</td><td className={num}>{sum((row) => row.figures.teamFee)}</td><td className={num}>{sum((row) => row.figures.cpTotal)}</td>
        <td className={num}>{sum((row) => row.figures.cgPay)}</td><td className={num}>{bahtText(summary.spent)}</td><td className={cell} colSpan={3}/>
        <td className={num}>{bahtText(summary.envelope)}</td><td className={num}>{sum((row) => row.figures.difference)}</td>
      </tr></tfoot>
    </table>

    <div className="mt-4 flex flex-wrap items-start gap-8 break-inside-avoid">
      <table className="border-collapse">
        <thead className="bg-sky-50"><tr><th className={cell}>กลุ่ม</th><th className={cell}>จำนวน (ราย)</th><th className={cell}>อัตรา/ราย/ปี</th><th className={cell}>วงเงินตามเดือนที่ดูแล</th><th className={cell}>ค่าใช้จ่ายตามแผน</th></tr></thead>
        <tbody>{summary.byGroup.map((group) => <tr key={group.group}><td className={cell}>กลุ่ม {group.group}</td><td className={num}>{group.count}</td><td className={num}>{bahtText(group.rate)}</td><td className={num}>{bahtText(group.envelope)}</td><td className={num}>{bahtText(group.spent)}</td></tr>)}</tbody>
        <tfoot className="font-bold">
          <tr><td className={cell}>รวม</td><td className={num}>{summary.countedCount}</td><td className={cell}/><td className={num}>{bahtText(summary.envelope)}</td><td className={num}>{bahtText(summary.spent)}</td></tr>
          {data.settings.approvedCeiling !== null && <tr><td className={cell} colSpan={3}>วงเงินที่กองทุนอนุมัติ</td><td className={num}>{bahtText(summary.ceiling)}</td><td className={cell}/></tr>}
          <tr><td className={cell} colSpan={3}>คงเหลือ</td><td className={num}>{bahtText(summary.remaining)}</td><td className={cell}/></tr>
        </tfoot>
      </table>
      {others.length > 0 && <div><p className="font-bold">ไม่รวมในแผน</p><ul className="list-disc pl-5">{others.map(({ line }) => <li key={line.lineId}>{line.fullName} — {line.excluded ? line.excludeReason : 'ยังไม่ได้จัดกลุ่ม'}</li>)}</ul></div>}
    </div>

    <div className="mt-10 grid grid-cols-2 gap-8 text-center break-inside-avoid">
      <div><p>ลงชื่อ ...................................................... ผู้จัดทำ</p><p className="mt-1">( ...................................................... )</p><p>ผู้จัดการการดูแล (Care Manager)</p></div>
      <div><p>ลงชื่อ ...................................................... ผู้อนุมัติ</p><p className="mt-1">( ...................................................... )</p><p>{data.settings.fundName || 'กองทุนหลักประกันสุขภาพ'}</p></div>
    </div>
  </main>;
}
