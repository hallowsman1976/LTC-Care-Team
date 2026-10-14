import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ClipboardCheck, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Actor, Page as ListPage } from '@smart-ltc/shared';
import { api, post } from '../lib/api';
import { Button, Card, ErrorState, Loading, Status } from '../components/ui';

function Page({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="space-y-5"><div><h2 className="text-2xl font-bold">{title}</h2><p className="text-slate-600">{description}</p></div>{children}</div>;
}

/** Lists show the first 50 rows; say so rather than implying the list is complete. */
export function MoreNotice({ page }: { page: ListPage<unknown> }) {
  return page.hasMore ? <p role="note" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">แสดง {page.items.length} รายการแรก ยังมีรายการเพิ่มเติม</p> : null;
}

interface VisitItem { visitId: string; visitDateTime: string; expectedEndTime?: string; visitType?: string; status: string; patientName?: string }
interface AlertItem { alertId: string; severity: string; alertType: string; eventAt: string; status: string }
interface ReviewItem {
  encounterId: string; visitId: string; performerId: string; performerName?: string; patientName?: string; visitType?: string; visitDateTime?: string;
  startedAt?: string; endedAt: string; notes?: string; vitalsJson?: string; urgentFlag?: boolean; status: string; recordVersion: number
}

function useVisits() {
  return useQuery({ queryKey: ['visits'], queryFn: () => api<ListPage<VisitItem>>('/visits') });
}

export function Visits({ actor }: { actor: Actor }) {
  const query = useVisits();
  return <Page title="งานเยี่ยมบ้าน" description="รายการที่ได้รับมอบหมายและสถานะการส่งงาน">
    {query.isLoading ? <Loading/> : query.error ? <ErrorState message={query.error.message}/> : query.data?.items.length ? <div className="space-y-3"><MoreNotice page={query.data}/>{query.data.items.map((visit) => <Card key={visit.visitId}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><ClipboardCheck aria-hidden className="text-primary"/><div><p className="font-bold">{new Date(visit.visitDateTime).toLocaleString('th-TH')}</p><p className="text-sm text-slate-500">{visit.patientName ? `${visit.patientName} · ` : ''}{visit.visitType || 'เยี่ยมตาม Care Plan'}</p></div></div><div className="flex flex-wrap items-center justify-end gap-2"><Status tone={visit.status === 'VERIFIED' ? 'success' : visit.status === 'SUBMITTED' ? 'warning' : 'neutral'}>{visit.status}</Status>{actor.role === 'CG' && visit.status === 'ASSIGNED' && <Link to={`/visits/${encodeURIComponent(visit.visitId)}`} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-3 text-sm font-semibold text-white">บันทึกการเยี่ยม</Link>}</div></div></Card>)}</div> : <Card><p className="text-center text-slate-500">ไม่มีงานเยี่ยมในขณะนี้</p></Card>}
  </Page>;
}

export function Calendar() {
  const query = useVisits();
  return <Page title="ปฏิทินเยี่ยม" description="ระบบไม่เลื่อนวันหยุดโดยอัตโนมัติ">
    {query.isLoading ? <Loading/> : query.error ? <ErrorState message={query.error.message}/> : <Card><div className="flex gap-3"><CalendarDays aria-hidden className="text-primary"/><div><p className="font-bold">รายการตามตาราง</p><p className="text-sm text-slate-600">{query.data?.items.length ?? 0}{query.data?.hasMore ? '+' : ''} งานที่ผู้ใช้มีสิทธิ์เข้าถึง</p></div></div></Card>}
  </Page>;
}

export function Alerts() {
  const query = useQuery({ queryKey: ['alerts'], queryFn: () => api<ListPage<AlertItem>>('/alerts') });
  return <Page title="แจ้งเตือนทางคลินิก" description="ระบบแจ้ง CM โดยไม่วินิจฉัยหรือแนะนำการรักษา">
    {query.isLoading ? <Loading/> : query.error ? <ErrorState message={query.error.message}/> : query.data?.items.length ? <div className="space-y-3"><MoreNotice page={query.data}/>{query.data.items.map((alert) => <Card key={alert.alertId}><div className="flex gap-3"><AlertTriangle aria-hidden className={alert.severity === 'HIGH' ? 'text-danger' : 'text-warning'}/><div><p className="font-bold">{alert.alertType}</p><p className="text-sm text-slate-600">{new Date(alert.eventAt).toLocaleString('th-TH')} · {alert.status}</p></div></div></Card>)}</div> : <Card><p className="text-center text-slate-500">ไม่มีแจ้งเตือนที่เปิดอยู่</p></Card>}
  </Page>;
}

export function Reviews() {
  const query = useQuery({ queryKey: ['reviews'], queryFn: () => api<ListPage<ReviewItem>>('/reviews') });
  // Urgent submissions first, then oldest first, so nothing pressing waits behind routine work.
  const items = [...(query.data?.items ?? [])].sort((left, right) => Number(Boolean(right.urgentFlag)) - Number(Boolean(left.urgentFlag)) || String(left.endedAt).localeCompare(String(right.endedAt)));
  return <Page title="ตรวจทานงานเยี่ยม" description="อ่านบันทึกของผู้ดูแล แล้วยืนยันผล หรือส่งคืนพร้อมเหตุผลให้แก้ไข รายการเร่งด่วนแสดงก่อน">
    {query.isLoading ? <Loading/> : query.error ? <ErrorState message={query.error.message}/> : items.length ? <div className="space-y-3"><MoreNotice page={query.data!}/>{items.map((review) => <ReviewCard key={review.encounterId} review={review}/>)}</div> : <Card><p className="text-center text-slate-500">ไม่มีรายการรอตรวจ</p></Card>}
  </Page>;
}

const RETURN_REASONS = ['บันทึกไม่ครบ ขอรายละเอียดเพิ่ม', 'เวลาเยี่ยมไม่สอดคล้องกับนัด', 'ขอให้วัดสัญญาณชีพซ้ำและบันทึกใหม่', 'กิจกรรมไม่ตรงกับ Care Plan'];

/** Accepts both a full date-time and the bare HH:MM older records used. */
export function formatVisitTime(value?: string): string {
  if (!value) return '–';
  if (!value.includes('T')) return value;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

function minutesBetween(start?: string, end?: string): number | null {
  if (!start?.includes('T') || !end?.includes('T')) return null;
  const minutes = Math.round((new Date(end).valueOf() - new Date(start).valueOf()) / 60_000);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function readVitals(json?: string): Array<{ label: string; value: string; outOfRange: boolean }> {
  let vitals: { temperature?: number; pulse?: number; respiration?: number; systolic?: number; diastolic?: number } = {};
  try { vitals = JSON.parse(json || '{}') as typeof vitals; } catch { return []; }
  const rows: Array<{ label: string; value: string; outOfRange: boolean }> = [];
  if (typeof vitals.temperature === 'number') rows.push({ label: 'อุณหภูมิ', value: `${vitals.temperature} °C`, outOfRange: vitals.temperature < 35.5 || vitals.temperature >= 37.5 });
  if (typeof vitals.pulse === 'number') rows.push({ label: 'ชีพจร', value: `${vitals.pulse} ครั้ง/นาที`, outOfRange: vitals.pulse < 60 || vitals.pulse > 100 });
  if (typeof vitals.respiration === 'number') rows.push({ label: 'หายใจ', value: `${vitals.respiration} ครั้ง/นาที`, outOfRange: vitals.respiration < 12 || vitals.respiration > 20 });
  if (typeof vitals.systolic === 'number' && typeof vitals.diastolic === 'number') {
    rows.push({ label: 'ความดันโลหิต', value: `${vitals.systolic}/${vitals.diastolic} mmHg`, outOfRange: vitals.systolic >= 140 || vitals.diastolic >= 90 || vitals.systolic < 90 || vitals.diastolic < 60 });
  }
  return rows;
}

/** A submitted visit: the CM verifies it, or returns it to the caregiver with a reason. */
function ReviewCard({ review }: { review: ReviewItem }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const vitals = readVitals(review.vitalsJson);
  const duration = minutesBetween(review.startedAt, review.endedAt);
  const decide = async (decision: 'VERIFIED' | 'RETURNED') => {
    if (decision === 'RETURNED' && notes.trim().length < 10) { setError('ระบุเหตุผลที่ส่งคืนอย่างน้อย 10 ตัวอักษร หรือกดเลือกเหตุผลด้านบน'); return; }
    setBusy(true); setError('');
    try {
      await post('/encounter-reviews', { encounterId: review.encounterId, decision, reviewNotes: notes.trim(), recordVersion: Number(review.recordVersion) });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['reviews'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  };
  return <Card className={review.urgentFlag ? 'border-red-300' : ''}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex gap-3"><FileText aria-hidden className={review.urgentFlag ? 'text-danger' : 'text-success'}/><div>
        <p className="text-lg font-bold">{review.patientName || `Visit ${review.visitId}`}</p>
        <p className="text-sm text-slate-600">{review.visitType || 'เยี่ยมตาม Care Plan'}{review.visitDateTime ? ` · นัด ${formatVisitTime(review.visitDateTime)}` : ''}</p>
        <p className="text-sm text-slate-600">ผู้ดูแล: {review.performerName || review.performerId}</p>
      </div></div>
      {review.urgentFlag && <Status tone="danger">ผู้ดูแลแจ้งเรื่องเร่งด่วน</Status>}
    </div>

    <dl className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3">
      <div><dt className="text-slate-500">เริ่ม</dt><dd className="font-semibold">{formatVisitTime(review.startedAt)}</dd></div>
      <div><dt className="text-slate-500">เสร็จ</dt><dd className="font-semibold">{formatVisitTime(review.endedAt)}</dd></div>
      <div><dt className="text-slate-500">ใช้เวลา</dt><dd className="font-semibold">{duration === null ? '–' : `${duration} นาที`}</dd></div>
    </dl>

    <div className="mt-3"><p className="text-sm font-semibold text-slate-700">สัญญาณชีพ</p>
      {vitals.length ? <div className="mt-1 flex flex-wrap gap-2">{vitals.map((vital) => <span key={vital.label} className={`rounded-lg px-3 py-1 text-sm ${vital.outOfRange ? 'bg-amber-100 font-semibold text-amber-900' : 'bg-slate-100'}`}>{vital.label} {vital.value}{vital.outOfRange ? ' · นอกช่วงปกติทั่วไป' : ''}</span>)}</div> : <p className="text-sm text-slate-500">ไม่ได้วัด</p>}
    </div>

    <div className="mt-3"><p className="text-sm font-semibold text-slate-700">บันทึกของผู้ดูแล</p>
      <p className="mt-1 whitespace-pre-line rounded-xl border border-slate-200 p-3 text-sm">{review.notes?.trim() || 'ไม่มีบันทึก'}</p>
    </div>

    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-sm font-semibold text-slate-700">หมายเหตุการตรวจ <span className="font-normal text-slate-500">(จำเป็นเมื่อส่งคืน บันทึกไว้กับรายการนี้)</span></p>
      <div className="mt-2 flex flex-wrap gap-2">{RETURN_REASONS.map((reason) => <button key={reason} type="button" onClick={() => setNotes((current) => (current.includes(reason) ? current : [current.trim(), reason].filter(Boolean).join('\n')))} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm hover:bg-sky-50">{reason}</button>)}</div>
      <textarea aria-label="หมายเหตุการตรวจ" value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"/>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" disabled={busy} onClick={() => decide('VERIFIED')}>ยืนยันผลการเยี่ยม</Button>
      <Button type="button" disabled={busy} onClick={() => decide('RETURNED')} className="border border-red-300 !bg-white !text-danger hover:!bg-red-50">ส่งคืนให้แก้ไข</Button>
    </div>
    {error && <div className="mt-3"><ErrorState message={error}/></div>}
  </Card>;
}

export function Placeholder({ title }: { title: string }) {
  return <Page title={title} description="ส่วนควบคุมนี้ต้องตั้งค่าผ่านผู้ดูแลระบบของหน่วยงาน"><Card><p className="text-slate-600">ยังไม่มีการดำเนินการในหน้านี้</p></Card></Page>;
}
