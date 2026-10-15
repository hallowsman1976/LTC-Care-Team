import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, Search, UserCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  importTemplateCsv, IMPORT_COLUMNS, MAX_IMPORT_ROWS_PER_REQUEST, readImportCsv, villageLabel,
  type Actor, type ImportPreview, type Page as ListPage, type PatientImportRow, type Role
} from '@smart-ltc/shared';
import { api, isDemoMode, post } from '../lib/api';
import { Button, Card, ErrorState, Loading, Status } from '../components/ui';
import { AdminPage, fieldClass, labelClass, messageOf } from './adminShared';
import { useCaregivers } from './Caregivers';

interface UserRow { userId: string; displayName: string; username: string; role: Role; enabled: boolean; createdAt?: string; credentialValidUntil?: string }

const ROLE_NAMES: Record<Role, string> = { ADMIN: 'ผู้ดูแลระบบ', CM: 'ผู้จัดการการดูแล (CM)', CG: 'ผู้ดูแล (CG)' };

const thaiDate = (value?: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '–';
};

/** CM sign-in depends on a verified clinical credential; flag it before it lapses. */
function CredentialStatus({ until }: { until?: string | undefined }) {
  if (!until) return <Status tone="danger">ยังไม่ได้ตรวจสอบใบประกอบวิชาชีพ</Status>;
  const days = Math.floor((new Date(until).valueOf() - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return <Status tone="danger">ใบประกอบวิชาชีพหมดอายุ</Status>;
  return <Status tone={days <= 30 ? 'warning' : 'neutral'}>ใบประกอบฯ ถึง {thaiDate(until)}</Status>;
}

/** Removes a user's authenticator so they set up a new one at their next sign-in (lost or changed phone). */
function MfaReset({ user }: { user: UserRow }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');
  const reset = async () => {
    if (!window.confirm(`รีเซ็ตแอปยืนยันตัวตนของ ${user.displayName || user.username}? ผู้ใช้จะถูกออกจากระบบ และต้องตั้งค่าแอปใหม่เมื่อเข้าสู่ระบบครั้งถัดไป`)) return;
    setState('busy');
    setError('');
    try {
      await post('/admin/users/mfa-reset', { userId: user.userId });
      setState('done');
    } catch (reason) {
      setError(messageOf(reason));
      setState('idle');
    }
  };
  if (state === 'done') return <p role="status" className="mt-2 text-sm text-success">รีเซ็ตแล้ว ผู้ใช้ต้องตั้งค่าแอปใหม่เมื่อเข้าสู่ระบบ</p>;
  return <div className="mt-2">
    <button type="button" onClick={reset} disabled={state === 'busy'} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-sky-50">รีเซ็ตแอปยืนยันตัวตน</button>
    {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
  </div>;
}

export function UserDirectory({ actor }: { actor: Actor }) {
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<ListPage<UserRow>>('/admin/users') });
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const items = users.data?.items ?? [];
  const me = items.find((user) => user.userId === actor.userId);
  const canManage = actor.capabilities.includes('users:manage');
  const visible = items.filter((user) => (!role || user.role === role) && `${user.displayName} ${user.username} ${user.userId}`.toLowerCase().includes(search.toLowerCase()));
  const countOf = (value: Role) => items.filter((user) => user.role === value).length;
  return <AdminPage title="ข้อมูลผู้ใช้งาน" description="บัญชีทั้งหมดในระบบ บทบาท ชื่อที่ใช้เข้าสู่ระบบ และสถานะ ระบบไม่แสดงรหัสผ่าน">
    <Card className="border-sky-200 bg-sky-50">
      <p className="text-sm text-slate-600">บัญชีของฉัน</p>
      <p className="text-lg font-bold">{me?.displayName || actor.userId}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Status tone="neutral">{ROLE_NAMES[actor.role]}</Status><span className="text-slate-600">{me?.username || actor.userId}</span>{actor.role === 'CM' && <CredentialStatus until={actor.credentialValidUntil}/>}</div>
    </Card>
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-60 flex-1"><span className="sr-only">ค้นหาผู้ใช้งาน</span><Search aria-hidden className="absolute left-3 top-3 text-slate-400" size={20}/><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3" placeholder="ค้นหาชื่อหรือชื่อผู้ใช้"/></label>
      <div role="group" aria-label="กรองตามบทบาท" className="flex flex-wrap gap-2">
        {([['', `ทั้งหมด ${items.length}`], ['CM', `CM ${countOf('CM')}`], ['CG', `CG ${countOf('CG')}`], ['ADMIN', `Admin ${countOf('ADMIN')}`]] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${role === value ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-sky-50'}`}>{label}</button>)}
      </div>
    </div>
    {users.isLoading ? <Loading/> : users.error ? <ErrorState message={users.error.message}/> : visible.length === 0 ? <Card><p className="text-center text-slate-500">ไม่พบผู้ใช้งาน</p></Card> : <div className="grid gap-3 md:grid-cols-2">
      {visible.map((user) => <Card key={user.userId}>
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-bold">{user.displayName || user.userId}{user.userId === actor.userId && <span className="ml-2 text-sm font-normal text-primary">(ฉัน)</span>}</p>
            <p className="text-sm text-slate-600">{user.username || 'ยังไม่มีชื่อเข้าสู่ระบบ'}</p>
            <p className="text-xs text-slate-500">เพิ่มเมื่อ {thaiDate(user.createdAt)}</p></div>
          <div className="flex flex-col items-end gap-1"><Status tone="neutral">{ROLE_NAMES[user.role] ?? user.role}</Status><Status tone={user.enabled ? 'success' : 'danger'}>{user.enabled ? 'ใช้งาน' : 'ปิดใช้งาน'}</Status></div>
        </div>
        {user.role === 'CM' && <div className="mt-2"><CredentialStatus until={user.credentialValidUntil}/></div>}
        {canManage && user.userId !== actor.userId && <MfaReset user={user}/>}
      </Card>)}
    </div>}
  </AdminPage>;
}

interface AssignmentRow { patientId: string; localCode: string; hn?: string; fullName: string; village?: string; hasActiveEpisode: boolean; caregiverUserId: string; caregiverName: string }

export function Assignments() {
  const queryClient = useQueryClient();
  const caregivers = useCaregivers();
  const assignments = useQuery({ queryKey: ['admin', 'assignments'], queryFn: () => api<ListPage<AssignmentRow>>('/admin/assignments') });
  const [search, setSearch] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const activeCaregivers = (caregivers.data?.items ?? []).filter((caregiver) => caregiver.enabled);
  const rows = assignments.data?.items ?? [];
  const unassignedCount = rows.filter((row) => !row.caregiverUserId).length;
  const visible = useMemo(() => rows.filter((row) => (!onlyUnassigned || !row.caregiverUserId)
    && `${row.fullName} ${row.localCode} ${row.hn ?? ''} ${row.village ?? ''} ${row.caregiverName}`.toLowerCase().includes(search.toLowerCase())), [rows, onlyUnassigned, search]);
  const toggle = (patientId: string) => setSelected((current) => { const next = new Set(current); if (next.has(patientId)) next.delete(patientId); else next.add(patientId); return next; });
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.patientId));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((row) => row.patientId)));

  const assign = async (patientIds: string[], caregiverUserId: string) => {
    if (!caregiverUserId || patientIds.length === 0) return;
    setBusy(true); setMessage(null);
    let done = 0;
    try {
      // One at a time: each assignment takes the workbook lock on the server anyway.
      for (const patientId of patientIds) { await post('/admin/assignments', { patientId, caregiverUserId }); done += 1; }
      const name = activeCaregivers.find((caregiver) => caregiver.userId === caregiverUserId)?.displayName ?? '';
      setMessage({ tone: 'success', text: `มอบหมาย ${done} รายให้ ${name} แล้ว งานเยี่ยมที่ยังไม่ถึงกำหนดย้ายไปยังผู้ดูแลคนใหม่` });
      setSelected(new Set());
    } catch (failure) {
      setMessage({ tone: 'error', text: `สำเร็จ ${done} จาก ${patientIds.length} ราย: ${messageOf(failure)}` });
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    }
  };

  if (assignments.isLoading || caregivers.isLoading) return <Loading/>;
  if (assignments.error || caregivers.error) return <ErrorState message={(assignments.error ?? caregivers.error)!.message}/>;
  return <AdminPage title="มอบหมายงาน CG" description="เลือกผู้ดูแลประจำของผู้รับบริการแต่ละราย ผู้ดูแลจะเห็นเฉพาะรายที่ได้รับมอบหมาย และงานเยี่ยมที่ยังไม่ถึงกำหนดจะย้ายตามไปด้วย">
    {activeCaregivers.length === 0 && <p role="note" className="rounded-xl bg-amber-50 p-3 text-amber-900">ยังไม่มี CG ที่ใช้งานได้ <Link to="/settings/caregivers" className="font-semibold underline">เพิ่ม CG ก่อน</Link></p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><p className="text-sm text-slate-600">ผู้รับบริการทั้งหมด</p><p className="text-2xl font-bold">{rows.length}</p></Card>
      <Card><p className="text-sm text-slate-600">มอบหมายแล้ว</p><p className="text-2xl font-bold text-success">{rows.length - unassignedCount}</p></Card>
      <Card><p className="text-sm text-slate-600">ยังไม่มอบหมาย</p><p className={`text-2xl font-bold ${unassignedCount ? 'text-danger' : ''}`}>{unassignedCount}</p></Card>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-60 flex-1"><span className="sr-only">ค้นหา</span><Search aria-hidden className="absolute left-3 top-3 text-slate-400" size={20}/><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3" placeholder="ค้นหาชื่อ รหัส HN หมู่บ้าน หรือชื่อ CG"/></label>
      <label className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3"><input type="checkbox" checked={onlyUnassigned} onChange={(event) => setOnlyUnassigned(event.target.checked)} className="h-5 w-5"/>เฉพาะที่ยังไม่มอบหมาย</label>
    </div>

    <Card className="sticky top-28 z-30 border-sky-200 bg-sky-50">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="h-5 w-5"/>เลือกทั้งหมดที่แสดง</label>
        <span className="text-sm text-slate-600">เลือกแล้ว {selected.size} ราย</span>
        <label className="flex flex-1 items-center gap-2"><span className="shrink-0 text-sm font-semibold">มอบหมายให้</span>
          <select value={target} onChange={(event) => setTarget(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3">
            <option value="">เลือก CG</option>{activeCaregivers.map((caregiver) => <option key={caregiver.userId} value={caregiver.userId}>{caregiver.displayName} (ดูแล {caregiver.activePatients} ราย)</option>)}
          </select>
        </label>
        <Button type="button" disabled={busy || !target || selected.size === 0} onClick={() => assign([...selected], target)}><UserCheck aria-hidden className="mr-2" size={18}/>{busy ? 'กำลังบันทึก…' : 'มอบหมาย'}</Button>
      </div>
    </Card>
    {message && (message.tone === 'success' ? <p role="status" className="flex items-center gap-2 rounded-xl bg-green-50 p-3 text-green-900"><CheckCircle2 aria-hidden size={18}/>{message.text}</p> : <ErrorState message={message.text}/>)}

    {visible.length === 0 ? <Card><p className="text-center text-slate-500">{rows.length ? 'ไม่พบรายการที่ตรงกับเงื่อนไข' : <>ยังไม่มีผู้รับบริการ <Link to="/settings/import" className="font-semibold text-primary underline">นำเข้าข้อมูล</Link></>}</p></Card> : <div className="space-y-2">
      {visible.map((row) => <Card key={row.patientId} className={selected.has(row.patientId) ? 'border-primary' : ''}>
        <div className="flex flex-wrap items-center gap-3">
          <input type="checkbox" aria-label={`เลือก ${row.fullName}`} checked={selected.has(row.patientId)} onChange={() => toggle(row.patientId)} className="h-5 w-5"/>
          <div className="min-w-48 flex-1"><p className="font-bold">{row.fullName}</p><p className="text-sm text-slate-600">{[row.localCode, row.hn ? `HN ${row.hn}` : '', row.village].filter(Boolean).join(' · ')}</p></div>
          {row.caregiverUserId ? <Status tone="success">CG: {row.caregiverName}</Status> : <Status tone="warning">ยังไม่มอบหมาย</Status>}
          <select aria-label={`เปลี่ยน CG ของ ${row.fullName}`} value="" disabled={busy || activeCaregivers.length === 0} onChange={(event) => assign([row.patientId], event.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3">
            <option value="">{row.caregiverUserId ? 'เปลี่ยน CG…' : 'มอบหมายให้…'}</option>
            {activeCaregivers.filter((caregiver) => caregiver.userId !== row.caregiverUserId).map((caregiver) => <option key={caregiver.userId} value={caregiver.userId}>{caregiver.displayName}</option>)}
          </select>
        </div>
      </Card>)}
    </div>}
  </AdminPage>;
}

const SKIP_REASONS: Record<string, string> = {
  DUPLICATE_HN: 'HN นี้มีในระบบแล้ว',
  DUPLICATE_CID: 'เลขประจำตัวประชาชนนี้มีในระบบแล้ว',
  POTENTIAL_DUPLICATE: 'ชื่อและวันเกิดตรงกับผู้รับบริการเดิม ให้ CM ตรวจสอบแล้วเพิ่มทีละราย'
};

interface ImportResult { created: number; assigned: number; skipped: Array<{ line: number; hn: string; reason: string }>; warnings: Array<{ line: number; hn: string; reason: string; detail: string }> }

/** Excel's “CSV UTF-8” is UTF-8; its plain “CSV” on Thai Windows is Windows-874 (TIS-620). */
async function readTextFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-874').decode(bytes); }
}

function downloadTemplate() {
  const blob = new Blob(['﻿', importTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: 'แม่แบบนำเข้าผู้มีภาวะพึ่งพิง.csv' });
  link.click();
  URL.revokeObjectURL(url);
}

export function PatientImport() {
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [legalBasis, setLegalBasis] = useState(isDemoMode ? '' : 'PUBLIC_HEALTH');
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const validRows = (preview?.rows ?? []).map((row) => row.row).filter((row): row is PatientImportRow => row !== null);
  const invalidRows = (preview?.rows ?? []).filter((row) => row.errors.length > 0);

  const choose = async (file: File | undefined) => {
    setPreview(null); setResult(null); setError(''); setFileName(file?.name ?? '');
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setError('รองรับเฉพาะไฟล์ .csv — ใน Excel เลือก “บันทึกเป็น” แล้วเลือกชนิด CSV UTF-8'); return; }
    setPreview(readImportCsv(await readTextFile(file)));
  };

  const runImport = async () => {
    if (!validRows.length) return;
    if (!isDemoMode && !legalBasis) { setError('กรุณาเลือกฐานการประมวลผล'); return; }
    setError(''); setResult(null);
    const total: ImportResult = { created: 0, assigned: 0, skipped: [], warnings: [] };
    setProgress({ sent: 0, total: validRows.length });
    try {
      for (let start = 0; start < validRows.length; start += MAX_IMPORT_ROWS_PER_REQUEST) {
        const chunk = validRows.slice(start, start + MAX_IMPORT_ROWS_PER_REQUEST);
        const answer = await post<ImportResult>('/admin/patients/import', {
          rows: chunk, legalBasis: legalBasis || undefined, privacyNoticeVersion: import.meta.env.VITE_PRIVACY_NOTICE_VERSION || undefined
        });
        total.created += answer.created; total.assigned += answer.assigned ?? 0; total.skipped.push(...answer.skipped); total.warnings.push(...(answer.warnings ?? []));
        setProgress({ sent: start + chunk.length, total: validRows.length });
      }
    } catch (failure) {
      setError(`${messageOf(failure)} (นำเข้าแล้ว ${total.created} ราย การนำเข้าซ้ำจะข้ามรายที่มีอยู่แล้วโดยอัตโนมัติ)`);
    } finally {
      setResult(total); setProgress(null);
      await queryClient.invalidateQueries();
    }
  };

  return <AdminPage title="นำเข้าข้อมูลผู้มีภาวะพึ่งพิง" description="นำเข้าทะเบียนผู้มีภาวะพึ่งพิงทีละหลายรายจากไฟล์ CSV ระบบเปิดช่วงการดูแลให้แต่ละราย (รอประเมิน ADL) แล้วจึงมอบหมาย CG ได้ทันที">
    {isDemoMode && <p role="note" className="rounded-xl bg-red-50 p-3 font-semibold text-red-900">ระบบ DEMO: ห้ามนำเข้าข้อมูลบุคคลจริง ใช้ข้อมูลสมมติเท่านั้น</p>}
    <Card>
      <h3 className="text-lg font-bold">1. ดาวน์โหลดแม่แบบและกรอกข้อมูล</h3>
      <Button type="button" onClick={downloadTemplate} className="mt-3"><Download aria-hidden className="mr-2" size={18}/>ดาวน์โหลดแม่แบบ (CSV)</Button>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>หนึ่งแถวต่อหนึ่งราย คงหัวตารางแถวแรกไว้ แถวที่ขึ้นต้นด้วย <code>#</code> (เช่นแถวตัวอย่าง) ระบบจะข้าม</li>
        <li>ใน Excel ให้ตั้งคอลัมน์ <b>เลขประจำตัวประชาชน</b> เป็น “ข้อความ” ก่อนวางข้อมูล เพื่อไม่ให้กลายเป็น 1.1E+12 (เบอร์โทรที่เลข 0 หาย ระบบเติมให้)</li>
        <li>วันที่ใช้ วว/ดด/ปปปป ได้ทั้ง พ.ศ. และ ค.ศ. (เช่น 15/03/2485) · ช่องตัวเลือกพิมพ์คำไทยได้ เช่น บัตรทอง, ติดบ้าน, บุตร · ช่องที่ไม่บังคับเว้นว่างได้</li>
        <li>ใส่ <b>ชื่อผู้ใช้ CG</b> (เช่น cg.somjai) เพื่อมอบหมายผู้ดูแลทันที ถ้าไม่พบชื่อ ระบบยังนำเข้าแต่ไม่มอบหมาย และแจ้งให้ทราบ</li>
        <li>ไฟล์จากแม่แบบเดิม (9 คอลัมน์) ยังนำเข้าได้ตามเดิม</li>
        <li>บันทึกเป็น “CSV UTF-8 (Comma delimited)” หรือดาวน์โหลดเป็น .csv จาก Google Sheets</li>
      </ul>
      <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-primary">คอลัมน์ในแม่แบบ</summary>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[32rem] text-left"><thead><tr className="border-b"><th className="py-1 pr-2">คอลัมน์</th><th className="pr-2">จำเป็น</th><th className="pr-2">ตัวอย่าง</th><th>ใส่ได้</th></tr></thead>
          <tbody>{IMPORT_COLUMNS.filter((column) => !column.legacy).map((column) => <tr key={column.key} className="border-b border-slate-100 align-top"><td className="py-1 pr-2 font-semibold">{column.header}</td><td className="pr-2">{column.required ? 'จำเป็น' : '–'}</td><td className="pr-2 text-slate-600">{column.example.replace(/^#/, '')}</td><td className="text-slate-600">{column.hint ?? (column.choices ? column.choices.map(([, label]) => label.split(' (')[0]).join(' / ') : '')}</td></tr>)}</tbody></table></div>
      </details>
    </Card>

    <Card>
      <h3 className="text-lg font-bold">2. เลือกไฟล์และตรวจสอบ</h3>
      <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center hover:bg-sky-50">
        <FileUp aria-hidden className="text-primary"/><span className="font-semibold">{fileName || 'แตะเพื่อเลือกไฟล์ .csv'}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ''; }}/>
      </label>
      {preview && <div className="mt-4 space-y-3">
        {preview.missingColumns.length > 0 && <ErrorState message={`ไม่พบคอลัมน์: ${preview.missingColumns.join(', ')} — กรุณาใช้หัวตารางตามแม่แบบ`}/>}
        <div className="flex flex-wrap gap-2"><Status tone="neutral">ทั้งหมด {preview.rows.length} แถว</Status><Status tone="success">พร้อมนำเข้า {validRows.length}</Status>{invalidRows.length > 0 && <Status tone="danger">ต้องแก้ไข {invalidRows.length}</Status>}</div>
        {invalidRows.length > 0 && <div className="max-h-72 overflow-auto rounded-xl border border-red-200">
          <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-red-50"><tr><th className="p-2">บรรทัด</th><th className="p-2">ชื่อ / HN</th><th className="p-2">ปัญหา</th></tr></thead>
            <tbody>{invalidRows.map((row) => <tr key={row.line} className="border-t border-red-100 align-top"><td className="p-2">{row.line}</td><td className="p-2">{row.values.fullName || '–'}<br/><span className="text-slate-500">{row.values.hn}</span></td><td className="p-2 text-red-800">{row.errors.join(' · ')}</td></tr>)}</tbody></table>
        </div>}
        {invalidRows.length > 0 && <p className="text-sm text-slate-600">แถวที่ต้องแก้ไขจะไม่ถูกนำเข้า แก้ในไฟล์แล้วเลือกไฟล์ใหม่ได้ (รายที่นำเข้าแล้วจะถูกข้ามอัตโนมัติ)</p>}
        {validRows.length > 0 && <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">บรรทัด</th><th className="p-2">ชื่อ–สกุล</th><th className="p-2">HN</th><th className="p-2">วันเกิด</th><th className="p-2">หมู่บ้าน</th></tr></thead>
            <tbody>{validRows.slice(0, 100).map((row) => <tr key={row.line} className="border-t border-slate-100"><td className="p-2">{row.line}</td><td className="p-2">{row.fullName}</td><td className="p-2">{row.hn}</td><td className="p-2">{new Date(`${row.birthDate}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</td><td className="p-2">{villageLabel(row.villageNo, row.villageName, row.village)}{row.caregiverUsername ? <span className="block text-xs text-slate-500">CG: {row.caregiverUsername}</span> : null}</td></tr>)}</tbody></table>
          {validRows.length > 100 && <p className="p-2 text-sm text-slate-500">แสดง 100 แถวแรกจาก {validRows.length}</p>}
        </div>}
      </div>}
    </Card>

    {preview && validRows.length > 0 && <Card>
      <h3 className="text-lg font-bold">3. นำเข้า</h3>
      {!isDemoMode && <label className={`${labelClass} mt-3 max-w-md`}>ฐานการประมวลผล (ใช้กับทุกรายในไฟล์)<select value={legalBasis} onChange={(event) => setLegalBasis(event.target.value)} className={fieldClass}><option value="">กรุณาเลือก</option><option value="PUBLIC_HEALTH">ภารกิจด้านสาธารณสุข</option><option value="MEDICAL_CARE">การให้บริการด้านสุขภาพ</option><option value="LEGAL_OBLIGATION">หน้าที่ตามกฎหมาย</option><option value="EXPLICIT_CONSENT">ความยินยอมโดยชัดแจ้ง</option></select></label>}
      <Button type="button" className="mt-3" disabled={Boolean(progress)} onClick={runImport}>{progress ? `กำลังนำเข้า ${progress.sent}/${progress.total}…` : `นำเข้า ${validRows.length} ราย`}</Button>
      {progress && <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={progress.sent} aria-valuemax={progress.total}><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(5, (progress.sent / progress.total) * 100)}%` }}/></div>}
    </Card>}

    {error && <ErrorState message={error}/>}
    {result && <Card className="border-green-200">
      <p className="flex items-center gap-2 text-lg font-bold text-green-900"><CheckCircle2 aria-hidden/>นำเข้าใหม่ {result.created} ราย{result.assigned ? ` · มอบหมาย CG แล้ว ${result.assigned} ราย` : ''}{result.skipped.length ? ` · ข้าม ${result.skipped.length} ราย` : ''}</p>
      {result.warnings.length > 0 && <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">นำเข้าแล้วแต่ยังไม่ได้มอบหมาย CG (ไม่พบชื่อผู้ใช้หรือบัญชีถูกปิด)</p><ul className="mt-1 space-y-1">{result.warnings.map((warning) => <li key={`${warning.line}-${warning.hn}`}>บรรทัด {warning.line} (HN {warning.hn}): {warning.detail}</li>)}</ul></div>}
      {result.skipped.length > 0 && <ul className="mt-2 space-y-1 text-sm">{result.skipped.map((skip) => <li key={`${skip.line}-${skip.hn}`}>บรรทัด {skip.line} (HN {skip.hn}): {SKIP_REASONS[skip.reason] ?? skip.reason}</li>)}</ul>}
      {result.created > result.assigned && <Link to="/assignments" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white"><UserCheck aria-hidden size={18}/>ไปมอบหมาย CG</Link>}
    </Card>}
  </AdminPage>;
}
