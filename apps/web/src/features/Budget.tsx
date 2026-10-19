import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Download, FilePlus2, Printer, RefreshCw, Save, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BUDGET_STATUS_LABELS, computeBudgetLine, fiscalYearOf, monthsLabel, summarizeBudget,
  type Actor, type BudgetLine, type BudgetLineEdit, type BudgetPlanDetail, type BudgetPlanSummary, type BudgetSettings, type Page as ListPage
} from '@smart-ltc/shared';
import { api, appHref, post, todayInBangkok } from '../lib/api';
import { downloadXlsx } from '../lib/xlsx';
import { Button, Card, ErrorState, Loading, Status } from '../components/ui';
import { AdminPage, fieldClass, labelClass, messageOf } from './adminShared';
import { bahtText, budgetWorkbook } from './budgetExport';

// งบประมาณ LTC: one plan per fiscal year. The CM edits a draft (settings and per-person figures,
// saved together), pulls the register again when people come or go, then approves it; a change
// after approval is a new version. ADMIN may read and export.

const thaiDateTime = (value: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
};
const statusTone = (status: string) => (status === 'APPROVED' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral');
const planKey = (planId: string) => ['budget', 'plan', planId];

export function BudgetPlans({ actor }: { actor: Actor }) {
  const navigate = useNavigate();
  const canManage = actor.capabilities.includes('budget:manage');
  const plans = useQuery({ queryKey: ['budget', 'plans'], queryFn: () => api<ListPage<BudgetPlanSummary>>('/budget-plans') });
  const currentYear = fiscalYearOf(todayInBangkok());
  const taken = new Set((plans.data?.items ?? []).map((plan) => plan.fiscalYear));
  const choices = [currentYear - 1, currentYear, currentYear + 1].filter((year) => !taken.has(year));
  const [year, setYear] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = year || (choices.includes(currentYear) ? currentYear : choices[0] ?? '');

  const create = async () => {
    if (!chosen) return;
    setBusy(true); setError('');
    try {
      const created = await post<{ planId: string }>('/budget-plans/create', { fiscalYear: chosen });
      navigate(`/budget/${created.planId}`);
    } catch (reason) { setError(messageOf(reason)); setBusy(false); }
  };

  const years = [...new Set((plans.data?.items ?? []).map((plan) => plan.fiscalYear))];
  return <AdminPage title="งบประมาณ LTC" description="แผนค่าใช้จ่ายที่ขอรับจากกองทุนหลักประกันสุขภาพตำบล ปีงบประมาณละ 1 แผน คิดวงเงินตามกลุ่มผู้มีภาวะพึ่งพิงและจำนวนเดือนที่อยู่ในการดูแล">
    {canManage && choices.length > 0 && <Card>
      <h3 className="font-bold">สร้างแผนใหม่</h3>
      <p className="text-sm text-slate-600">ระบบดึงรายชื่อผู้ที่อยู่ในการดูแลช่วงปีงบประมาณนั้น พร้อมกลุ่มที่ยืนยันแล้ว จำนวนเดือน และ CG ให้อัตโนมัติ</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className={labelClass}>ปีงบประมาณ
          <select value={chosen} onChange={(event) => setYear(Number(event.target.value))} className={`${fieldClass} min-w-40`}>
            {choices.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <Button type="button" onClick={create} disabled={busy || !chosen}><FilePlus2 aria-hidden className="mr-2" size={18}/>{busy ? 'กำลังสร้าง…' : 'สร้างแผน'}</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Card>}
    {plans.isLoading ? <Loading/> : plans.error ? <ErrorState message={plans.error.message}/> : years.length === 0
      ? <Card><p className="text-center text-slate-500">ยังไม่มีแผนงบประมาณ</p></Card>
      : years.map((fiscalYear) => <Card key={fiscalYear}>
        <h3 className="text-lg font-bold">ปีงบประมาณ {fiscalYear}</h3>
        <ul className="mt-2 divide-y divide-slate-100">
          {(plans.data?.items ?? []).filter((plan) => plan.fiscalYear === fiscalYear).map((plan) => <li key={plan.planId}>
            <Link to={`/budget/${plan.planId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-3 hover:bg-sky-50">
              <span><span className="font-semibold">ฉบับที่ {plan.version}</span><span className="ml-2 text-sm text-slate-600">{plan.lineCount} ราย · แก้ไขล่าสุด {thaiDateTime(plan.updatedAt)}</span>
                {plan.approvedAt && <span className="block text-sm text-slate-600">อนุมัติ {thaiDateTime(plan.approvedAt)} โดย {plan.approvedByName || '–'}</span>}</span>
              <Status tone={statusTone(plan.status)}>{BUDGET_STATUS_LABELS[plan.status]}</Status>
            </Link>
          </li>)}
        </ul>
      </Card>)}
  </AdminPage>;
}

const editOf = (line: BudgetLine): BudgetLineEdit => ({
  lineId: line.lineId, diapersPerDay: line.diapersPerDay, diaperCount: line.diaperCount, otherSupplies: line.otherSupplies,
  assessFee: line.assessFee, reassessFee: line.reassessFee, teamFee: line.teamFee, cgMonthly: line.cgMonthly,
  excluded: line.excluded, excludeReason: line.excludeReason, note: line.note
});

/** A number box; empty means null when `nullable` (use the default shown as placeholder), else 0. */
function NumberField({ label, value, onChange, nullable = false, placeholder, disabled, step = 'any', suffix }: {
  label: string; value: number | null; onChange: (value: number | null) => void; nullable?: boolean; placeholder?: string; disabled: boolean; step?: string; suffix?: string;
}) {
  return <label className={labelClass}>{label}{suffix && <span className="font-normal text-slate-500"> ({suffix})</span>}
    <input type="number" inputMode="decimal" min={0} step={step} disabled={disabled} placeholder={placeholder}
      value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? (nullable ? null : 0) : Math.max(0, Number(event.target.value)))}
      className={`${fieldClass} disabled:bg-slate-50`}/>
  </label>;
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className={strong ? 'font-bold' : ''}>{value}</dd></div>;
}

function LineCard({ line, settings, editable, onChange }: { line: BudgetPlanDetail['lines'][number]; settings: BudgetSettings; editable: boolean; onChange: (changes: Partial<BudgetLineEdit>) => void }) {
  const figures = computeBudgetLine(settings, line);
  const groupChanged = line.currentGroup !== line.groupNumber;
  const disabled = !editable || line.groupNumber === null;
  return <Card className={line.excluded ? 'opacity-70' : ''}>
    <details>
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">{line.fullName}</p>
          <p className="text-sm text-slate-600">{[line.age !== null ? `${line.age} ปี` : '', line.adlScore !== null ? `ADL ${line.adlScore}` : '', `ดูแล ${monthsLabel(line.serviceMonths)}${line.serviceMonths >= 12 ? ' 12 เดือน' : ''}`, line.caregiverName ? `CG ${line.caregiverName}` : 'ยังไม่มี CG'].filter(Boolean).join(' · ')}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {line.groupNumber === null ? <Status tone="neutral">ยังไม่จัดกลุ่ม</Status> : <Status tone="neutral">กลุ่ม {line.groupNumber}</Status>}
            {line.excluded && <Status tone="neutral">ไม่รวมในแผน</Status>}
            {figures.overRate && <Status tone="warning">เกินอัตรากลุ่ม {bahtText(-figures.difference)} บาท</Status>}
            {groupChanged && <Status tone="warning">กลุ่มปัจจุบัน: {line.currentGroup ?? 'ยังไม่จัดกลุ่ม'}</Status>}
            {line.caregiverChanged && <Status tone="neutral">เปลี่ยน CG ระหว่างปี</Status>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          {figures.counted
            ? <div><p className="font-bold">{bahtText(figures.total)}</p><p className="text-xs text-slate-500">วงเงินกลุ่ม {bahtText(figures.groupRate)}</p></div>
            : <p className="text-sm text-slate-500">ไม่นับในแผน</p>}
          <ChevronDown aria-hidden size={18} className="text-slate-400"/>
        </div>
      </summary>
      {line.groupNumber === null && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">ยังไม่นับเข้าวงเงินจนกว่า CM จะยืนยันกลุ่ม แล้วกด “ดึงรายชื่อใหม่”</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField label="ผ้าอ้อม/วัน" suffix="ชิ้น" step="1" value={line.diapersPerDay} disabled={disabled} onChange={(value) => onChange({ diapersPerDay: Math.round(value ?? 0) })}/>
        <NumberField label="จำนวนผ้าอ้อมทั้งปี" suffix="ชิ้น" step="1" nullable value={line.diaperCount} placeholder={`${line.diapersPerDay * line.serviceDays} (${line.serviceDays} วัน)`} disabled={disabled} onChange={(value) => onChange({ diaperCount: value === null ? null : Math.round(value) })}/>
        <NumberField label="วัสดุการแพทย์อื่นๆ" suffix="บาท" value={line.otherSupplies} disabled={disabled} onChange={(value) => onChange({ otherSupplies: value ?? 0 })}/>
        <NumberField label="ค่าตอบแทน CG/เดือน" suffix="บาท" nullable value={line.cgMonthly} placeholder={`${settings.cgMonthly} (ค่าเริ่มต้น)`} disabled={disabled} onChange={(value) => onChange({ cgMonthly: value })}/>
        <NumberField label="ประเมิน/วางแผน" suffix="บาท" nullable value={line.assessFee} placeholder={`${settings.assessFee} (ค่าเริ่มต้น)`} disabled={disabled} onChange={(value) => onChange({ assessFee: value })}/>
        <NumberField label="ประเมิน/ปรับแผน" suffix="บาท" nullable value={line.reassessFee} placeholder={`${settings.reassessFee} (ค่าเริ่มต้น)`} disabled={disabled} onChange={(value) => onChange({ reassessFee: value })}/>
        <NumberField label="ค่าตอบแทนทีมสาธารณสุข" suffix="บาท" nullable value={line.teamFee} placeholder={`${settings.teamFee} (ค่าเริ่มต้น)`} disabled={disabled} onChange={(value) => onChange({ teamFee: value })}/>
        <label className={labelClass}>หมายเหตุ<input value={line.note} maxLength={300} disabled={!editable} onChange={(event) => onChange({ note: event.target.value })} className={`${fieldClass} disabled:bg-slate-50`}/></label>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-5">
        <Figure label={`ผ้าอ้อม ${figures.diaperCount} ชิ้น`} value={bahtText(figures.diaperCost)}/>
        <Figure label="ค่าจัดการ CP" value={bahtText(figures.cpTotal)}/>
        <Figure label={`CG ${line.serviceMonths} เดือน`} value={bahtText(figures.cgPay)}/>
        <Figure label="รวม" value={bahtText(figures.total)} strong/>
        <Figure label="ส่วนต่างจากอัตรากลุ่ม" value={bahtText(figures.difference)} strong/>
      </dl>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={line.excluded} disabled={!editable} onChange={(event) => onChange({ excluded: event.target.checked })} className="h-5 w-5"/>ไม่รวมในแผน</label>
        {line.excluded && <label className={`${labelClass} flex-1`}>เหตุผล (อย่างน้อย 5 ตัวอักษร)<input value={line.excludeReason} maxLength={300} disabled={!editable} onChange={(event) => onChange({ excludeReason: event.target.value })} className={`${fieldClass} disabled:bg-slate-50`}/></label>}
      </div>
    </details>
  </Card>;
}

function SettingsForm({ settings, editable, onChange }: { settings: BudgetSettings; editable: boolean; onChange: (settings: BudgetSettings) => void }) {
  const set = (changes: Partial<BudgetSettings>) => onChange({ ...settings, ...changes });
  const setRate = (index: number, value: number) => set({ groupRates: settings.groupRates.map((rate, at) => (at === index ? value : rate)) as BudgetSettings['groupRates'] });
  return <div className="space-y-4">
    <Card>
      <h3 className="font-bold">หัวกระดาษ</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className={labelClass}>ชื่อกองทุน<input value={settings.fundName} maxLength={200} disabled={!editable} placeholder="กองทุนหลักประกันสุขภาพตำบล…" onChange={(event) => set({ fundName: event.target.value })} className={`${fieldClass} disabled:bg-slate-50`}/></label>
        <label className={labelClass}>หน่วยบริการ<input value={settings.unitName} maxLength={200} disabled={!editable} placeholder="รพ.สต. …" onChange={(event) => set({ unitName: event.target.value })} className={`${fieldClass} disabled:bg-slate-50`}/></label>
      </div>
    </Card>
    <Card>
      <h3 className="font-bold">อัตราต่อรายต่อปี ตามกลุ่ม</h3>
      <p className="text-sm text-slate-600">ผู้ที่อยู่ในการดูแลไม่ครบปี คิดตามจำนวนเดือน (เดือนที่อยู่ 15 วันขึ้นไปนับเป็น 1 เดือน)</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {settings.groupRates.map((rate, index) => <NumberField key={index} label={`กลุ่ม ${index + 1}`} suffix="บาท" value={rate} disabled={!editable} onChange={(value) => setRate(index, value ?? 0)}/>)}
      </div>
    </Card>
    <Card>
      <h3 className="font-bold">ค่าเริ่มต้นรายบุคคล</h3>
      <p className="text-sm text-slate-600">ใช้กับทุกรายที่ไม่ได้กรอกยอดเอง</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NumberField label="ราคาผ้าอ้อม/ชิ้น" suffix="บาท" value={settings.diaperPrice} disabled={!editable} onChange={(value) => set({ diaperPrice: value ?? 0 })}/>
        <NumberField label="ประเมิน/วางแผนให้บริการ" suffix="บาท/ราย" value={settings.assessFee} disabled={!editable} onChange={(value) => set({ assessFee: value ?? 0 })}/>
        <NumberField label="ประเมิน/ปรับแผนให้บริการ" suffix="บาท/ราย" value={settings.reassessFee} disabled={!editable} onChange={(value) => set({ reassessFee: value ?? 0 })}/>
        <NumberField label="ค่าตอบแทนทีมบุคลากรสาธารณสุข" suffix="บาท/ราย" value={settings.teamFee} disabled={!editable} onChange={(value) => set({ teamFee: value ?? 0 })}/>
        <NumberField label="ค่าตอบแทน CG" suffix="บาท/ราย/เดือน" value={settings.cgMonthly} disabled={!editable} onChange={(value) => set({ cgMonthly: value ?? 0 })}/>
      </div>
    </Card>
    <Card>
      <h3 className="font-bold">วงเงินที่กองทุนอนุมัติจริง</h3>
      <p className="text-sm text-slate-600">เว้นว่างไว้ได้ ถ้ากรอก ระบบจะใช้ยอดนี้เป็นเพดานแทนวงเงินที่คำนวณจากกลุ่ม</p>
      <div className="mt-3 max-w-xs"><NumberField label="วงเงินที่อนุมัติ" suffix="บาท" nullable value={settings.approvedCeiling} placeholder="ยังไม่ระบุ" disabled={!editable} onChange={(value) => set({ approvedCeiling: value })}/></div>
    </Card>
  </div>;
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${active ? 'bg-primary text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-sky-50'}`}>{children}</button>;
}

type LineFilter = 'all' | 'over' | 'unclassified' | 'changed' | 'excluded';

export function BudgetPlanPage({ actor }: { actor: Actor }) {
  const { planId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const plan = useQuery({ queryKey: planKey(planId), queryFn: () => post<BudgetPlanDetail>('/budget-plans/get', { planId }) });
  const [settings, setSettings] = useState<BudgetSettings | null>(null);
  const [edits, setEdits] = useState<Map<string, BudgetLineEdit>>(new Map());
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [tab, setTab] = useState<'lines' | 'settings' | 'summary'>('lines');
  const [filter, setFilter] = useState<LineFilter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const data = plan.data;
  useEffect(() => {
    if (!data) return;
    setSettings(data.settings);
    setEdits(new Map());
    setSettingsDirty(false);
  }, [data]);

  const dirty = settingsDirty || edits.size > 0;
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const lines = useMemo(() => (data?.lines ?? []).map((line) => ({ ...line, ...edits.get(line.lineId) })), [data, edits]);
  const current = settings ?? data?.settings;
  const summary = useMemo(() => (current ? summarizeBudget(current, lines) : null), [current, lines]);
  if (plan.isLoading) return <Loading/>;
  if (plan.error || !data || !current || !summary) return <ErrorState message={plan.error?.message ?? 'ไม่พบแผน'}/>;

  const editable = actor.capabilities.includes('budget:manage') && data.status === 'DRAFT';
  const canRevise = actor.capabilities.includes('budget:manage') && data.status === 'APPROVED';
  const changeLine = (line: BudgetLine, changes: Partial<BudgetLineEdit>) => setEdits((map) => new Map(map).set(line.lineId, { ...editOf(line), ...map.get(line.lineId), ...changes }));
  const invalidExclusion = lines.some((line) => line.excluded && line.excludeReason.trim().length < 5);

  const run = async (label: string, work: () => Promise<string>) => {
    setBusy(label); setMessage(null);
    try {
      const text = await work();
      setMessage({ tone: 'success', text });
    } catch (reason) {
      setMessage({ tone: 'error', text: messageOf(reason) });
    } finally { setBusy(''); }
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['budget'] });
  const save = () => run('save', async () => {
    await post('/budget-plans/save', { planId, recordVersion: data.recordVersion, settings: current, lines: [...edits.values()] });
    await refresh();
    // The reloaded plan now holds the edits (and a refetch that changed nothing keeps the same object).
    setEdits(new Map());
    setSettingsDirty(false);
    return 'บันทึกแล้ว';
  });
  const sync = () => run('sync', async () => {
    const result = await post<{ added: number }>('/budget-plans/sync', { planId, recordVersion: data.recordVersion });
    await refresh();
    return result.added ? `ดึงรายชื่อแล้ว เพิ่มใหม่ ${result.added} ราย` : 'ดึงรายชื่อแล้ว ไม่มีรายใหม่';
  });
  const approve = () => {
    if (!window.confirm(`อนุมัติแผนปีงบประมาณ ${data.fiscalYear} ฉบับที่ ${data.version}? เมื่ออนุมัติแล้วจะแก้ไขไม่ได้`)) return;
    void run('approve', async () => {
      await post('/budget-plans/approve', { planId, recordVersion: data.recordVersion, note });
      await refresh();
      return 'อนุมัติแผนแล้ว';
    });
  };
  const revise = () => run('revise', async () => {
    const created = await post<{ planId: string }>('/budget-plans/revise', { planId, reason });
    await refresh();
    navigate(`/budget/${created.planId}`);
    return 'สร้างฉบับปรับปรุงแล้ว';
  });
  const exportXlsx = () => downloadXlsx(`งบ LTC ปี ${data.fiscalYear} ฉบับที่ ${data.version}.xlsx`, budgetWorkbook({ ...data, settings: current, lines }));

  const counts: Record<LineFilter, number> = {
    all: lines.length,
    over: lines.filter((line) => computeBudgetLine(current, line).overRate).length,
    unclassified: lines.filter((line) => line.groupNumber === null).length,
    changed: lines.filter((line) => line.currentGroup !== line.groupNumber).length,
    excluded: lines.filter((line) => line.excluded).length
  };
  const visible = lines.filter((line) => {
    if (filter === 'over' && !computeBudgetLine(current, line).overRate) return false;
    if (filter === 'unclassified' && line.groupNumber !== null) return false;
    if (filter === 'changed' && line.currentGroup === line.groupNumber) return false;
    if (filter === 'excluded' && !line.excluded) return false;
    return `${line.fullName} ${line.address} ${line.caregiverName}`.toLowerCase().includes(search.toLowerCase());
  });
  const filters: Array<[LineFilter, string]> = [['all', 'ทั้งหมด'], ['over', 'เกินอัตรากลุ่ม'], ['unclassified', 'ยังไม่จัดกลุ่ม'], ['changed', 'กลุ่มเปลี่ยน'], ['excluded', 'ไม่รวมในแผน']];

  return <div className="space-y-5 pb-24">
    <div>
      <Link to="/budget" className="text-sm text-primary">← งบประมาณ LTC</Link>
      <div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="text-2xl font-bold">ปีงบประมาณ {data.fiscalYear} · ฉบับที่ {data.version}</h2><Status tone={statusTone(data.status)}>{BUDGET_STATUS_LABELS[data.status]}</Status></div>
      <p className="text-sm text-slate-600">ดึงรายชื่อล่าสุด {thaiDateTime(data.syncedAt)}{data.approvedAt ? ` · อนุมัติ ${thaiDateTime(data.approvedAt)} โดย ${data.approvedByName || '–'}` : ''}</p>
      {data.revisionReason && <p className="text-sm text-slate-600">เหตุผลที่ปรับปรุง: {data.revisionReason}</p>}
    </div>

    <Card className={summary.overBudget ? 'border-red-200 bg-red-50' : 'border-sky-200 bg-sky-50'}>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label={current.approvedCeiling === null ? 'วงเงินตามกลุ่ม' : 'วงเงินที่กองทุนอนุมัติ'} value={`${bahtText(summary.ceiling)} บาท`} strong/>
        <Figure label="ค่าใช้จ่ายตามแผน" value={`${bahtText(summary.spent)} บาท`} strong/>
        <Figure label="คงเหลือ" value={`${bahtText(summary.remaining)} บาท`} strong/>
        <Figure label="ผู้ป่วยที่นับในแผน" value={`${summary.countedCount} ราย`}/>
      </dl>
      {summary.overBudget && <p role="alert" className="mt-2 flex items-center gap-2 text-sm font-semibold text-red-800"><AlertTriangle aria-hidden size={18}/>ค่าใช้จ่ายเกินวงเงิน {bahtText(-summary.remaining)} บาท อนุมัติไม่ได้จนกว่าจะปรับยอด</p>}
      {(summary.unclassifiedCount > 0 || counts.changed > 0) && <p className="mt-2 text-sm text-amber-900">
        {summary.unclassifiedCount > 0 && `ยังไม่จัดกลุ่ม ${summary.unclassifiedCount} ราย (ไม่นับเข้าวงเงิน) `}
        {counts.changed > 0 && `· กลุ่มเปลี่ยนหลังดึงรายชื่อ ${counts.changed} ราย ${editable ? 'กด “ดึงรายชื่อใหม่” เพื่อใช้กลุ่มปัจจุบัน' : 'สร้างฉบับปรับปรุงถ้าต้องการใช้กลุ่มปัจจุบัน'}`}
      </p>}
    </Card>

    <div role="tablist" aria-label="ส่วนของแผน" className="flex flex-wrap gap-2">
      <Tab active={tab === 'lines'} onClick={() => setTab('lines')}>แผนรายบุคคล ({lines.length})</Tab>
      <Tab active={tab === 'settings'} onClick={() => setTab('settings')}>ตั้งค่าปีงบ</Tab>
      <Tab active={tab === 'summary'} onClick={() => setTab('summary')}>สรุปและส่งออก</Tab>
    </div>

    {tab === 'lines' && <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-60 flex-1"><span className="sr-only">ค้นหาผู้ป่วย</span><Search aria-hidden className="absolute left-3 top-3 text-slate-400" size={20}/><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3" placeholder="ค้นหาชื่อ ที่อยู่ หรือ CG"/></label>
        {editable && <button type="button" onClick={sync} disabled={dirty || Boolean(busy)} title={dirty ? 'บันทึกก่อนดึงรายชื่อใหม่' : undefined} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-sky-50 disabled:opacity-60"><RefreshCw aria-hidden className="mr-2" size={16}/>{busy === 'sync' ? 'กำลังดึง…' : 'ดึงรายชื่อใหม่'}</button>}
      </div>
      <div role="group" aria-label="กรองรายชื่อ" className="flex flex-wrap gap-2">
        {filters.filter(([value]) => value === 'all' || counts[value] > 0).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${filter === value ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-sky-50'}`}>{label} {counts[value]}</button>)}
      </div>
      {visible.length === 0 ? <Card><p className="text-center text-slate-500">ไม่พบรายชื่อ</p></Card>
        : visible.map((line) => <LineCard key={line.lineId} line={line} settings={current} editable={editable} onChange={(changes) => changeLine(line, changes)}/>)}
    </div>}

    {tab === 'settings' && <SettingsForm settings={current} editable={editable} onChange={(next) => { setSettings(next); setSettingsDirty(true); }}/>}

    {tab === 'summary' && <div className="space-y-4">
      <Card>
        <h3 className="font-bold">สรุปตามกลุ่ม</h3>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[32rem] text-sm">
          <thead><tr className="border-b text-left text-slate-600"><th className="py-2">กลุ่ม</th><th className="text-right">จำนวน</th><th className="text-right">อัตรา/ราย/ปี</th><th className="text-right">วงเงินตามเดือนที่ดูแล</th><th className="text-right">ค่าใช้จ่ายตามแผน</th></tr></thead>
          <tbody>{summary.byGroup.map((group) => <tr key={group.group} className="border-b border-slate-100"><td className="py-2">กลุ่ม {group.group}</td><td className="text-right">{group.count}</td><td className="text-right">{bahtText(group.rate)}</td><td className="text-right">{bahtText(group.envelope)}</td><td className="text-right">{bahtText(group.spent)}</td></tr>)}</tbody>
          <tfoot><tr className="font-bold"><td className="py-2">รวม</td><td className="text-right">{summary.countedCount}</td><td/><td className="text-right">{bahtText(summary.envelope)}</td><td className="text-right">{bahtText(summary.spent)}</td></tr></tfoot>
        </table></div>
        {summary.excludedCount > 0 && <p className="mt-2 text-sm text-slate-600">ไม่รวมในแผน {summary.excludedCount} ราย</p>}
      </Card>
      <Card>
        <h3 className="font-bold">ส่งออก</h3>
        <p className="text-sm text-slate-600">{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก หน้าพิมพ์จะแสดงข้อมูลที่บันทึกแล้วเท่านั้น' : 'ไฟล์ Excel มีสูตรรวมยอด แก้ตัวเลขในไฟล์แล้วยอดรวมจะคำนวณใหม่'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={exportXlsx}><Download aria-hidden className="mr-2" size={18}/>ดาวน์โหลด Excel (.xlsx)</Button>
          <a href={appHref(`/budget/${planId}/print`)} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-sky-50"><Printer aria-hidden className="mr-2" size={18}/>หน้าพิมพ์ A4 / PDF</a>
        </div>
      </Card>
      {editable && <Card>
        <h3 className="font-bold">อนุมัติแผน</h3>
        <p className="text-sm text-slate-600">เมื่ออนุมัติแล้ว แผนและอัตราทั้งหมดจะถูกล็อก ถ้าต้องแก้ไขภายหลังให้สร้างฉบับปรับปรุง</p>
        <label className={`${labelClass} mt-3`}>บันทึกการอนุมัติ (ถ้ามี)<input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ตามมติคณะกรรมการกองทุน ครั้งที่ …" className={fieldClass}/></label>
        <Button type="button" onClick={approve} disabled={dirty || summary.overBudget || summary.countedCount === 0 || Boolean(busy)} className="mt-3">{busy === 'approve' ? 'กำลังอนุมัติ…' : 'อนุมัติแผน'}</Button>
        {dirty && <p className="mt-2 text-sm text-slate-600">บันทึกการแก้ไขก่อนอนุมัติ</p>}
      </Card>}
      {data.status === 'APPROVED' && data.approvalNote && <Card><p className="text-sm text-slate-600">บันทึกการอนุมัติ</p><p>{data.approvalNote}</p></Card>}
      {canRevise && <Card>
        <h3 className="font-bold">สร้างฉบับปรับปรุง</h3>
        <p className="text-sm text-slate-600">คัดลอกแผนนี้เป็นฉบับร่างใหม่ ฉบับนี้ยังใช้อยู่จนกว่าฉบับใหม่จะได้รับอนุมัติ</p>
        <label className={`${labelClass} mt-3`}>เหตุผลที่ปรับปรุง<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="เช่น ผู้ป่วยเปลี่ยนกลุ่ม / กองทุนปรับวงเงิน" className={fieldClass}/></label>
        <Button type="button" onClick={revise} disabled={reason.trim().length < 5 || Boolean(busy)} className="mt-3">{busy === 'revise' ? 'กำลังสร้าง…' : 'สร้างฉบับปรับปรุง'}</Button>
      </Card>}
    </div>}

    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 ${message.tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-900'}`}>{message.text}</p>}

    {editable && <div className="fixed inset-x-0 bottom-16 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 md:bottom-0 md:left-64">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{invalidExclusion ? 'ระบุเหตุผลของรายที่ไม่รวมในแผน (อย่างน้อย 5 ตัวอักษร)' : dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'บันทึกแล้ว'}</p>
        <Button type="button" onClick={save} disabled={!dirty || invalidExclusion || Boolean(busy)}><Save aria-hidden className="mr-2" size={18}/>{busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}</Button>
      </div>
    </div>}
  </div>;
}
