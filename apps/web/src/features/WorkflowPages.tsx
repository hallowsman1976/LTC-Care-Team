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
interface ReviewItem { encounterId: string; visitId: string; performerId: string; endedAt: string; status: string; recordVersion: number }

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
  return <Page title="ตรวจทานงานเยี่ยม" description="SUBMITTED → VERIFIED หรือ RETURNED">
    {query.isLoading ? <Loading/> : query.error ? <ErrorState message={query.error.message}/> : query.data?.items.length ? <div className="space-y-3"><MoreNotice page={query.data}/>{query.data.items.map((review) => <ReviewCard key={review.encounterId} review={review}/>)}</div> : <Card><p className="text-center text-slate-500">ไม่มีรายการรอตรวจ</p></Card>}
  </Page>;
}

/** A submitted visit: the CM verifies it, or returns it to the caregiver with a reason. */
function ReviewCard({ review }: { review: ReviewItem }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (decision: 'VERIFIED' | 'RETURNED') => {
    if (decision === 'RETURNED' && notes.trim().length < 10) { setError('ระบุเหตุผลที่ส่งคืนอย่างน้อย 10 ตัวอักษร'); return; }
    setBusy(true); setError('');
    try {
      await post('/encounter-reviews', { encounterId: review.encounterId, decision, reviewNotes: notes.trim(), recordVersion: Number(review.recordVersion) });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['reviews'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  };
  return <Card>
    <div className="flex gap-3"><FileText aria-hidden className="text-success"/><div><p className="font-bold">Visit {review.visitId}</p><p className="text-sm text-slate-600">ส่งโดย {review.performerId} · {new Date(review.endedAt).toLocaleString('th-TH')}</p></div></div>
    <label className="mt-3 block text-sm font-semibold text-slate-700">หมายเหตุการตรวจ (จำเป็นเมื่อส่งคืน)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"/></label>
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
