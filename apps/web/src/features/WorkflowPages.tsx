import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ClipboardCheck, FileText } from 'lucide-react';
import type { Page as ListPage } from '@smart-ltc/shared';
import { api } from '../lib/api';
import { Card, ErrorState, Loading, Status } from '../components/ui';

function Page({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="space-y-5"><div><h2 className="text-2xl font-bold">{title}</h2><p className="text-slate-600">{description}</p></div>{children}</div>;
}

/** Lists show the first 50 rows; say so rather than implying the list is complete. */
export function MoreNotice({ page }: { page: ListPage<unknown> }) {
  return page.hasMore ? <p role="note" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">แสดง {page.items.length} รายการแรก ยังมีรายการเพิ่มเติม</p> : null;
}

interface VisitItem { visitId: string; visitDateTime: string; expectedEndTime?: string; visitType?: string; status: string }
interface AlertItem { alertId: string; severity: string; alertType: string; eventAt: string; status: string }
interface ReviewItem { encounterId: string; visitId: string; performerId: string; endedAt: string; status: string }

function useVisits() {
  return useQuery({ queryKey: ['visits'], queryFn: () => api<ListPage<VisitItem>>('/visits') });
}

export function Visits() {
  const query = useVisits();
  return <Page title="งานเยี่ยมบ้าน" description="รายการที่ได้รับมอบหมายและสถานะการส่งงาน">
    {query.isLoading ? <Loading/> : query.error ? <ErrorState message={query.error.message}/> : query.data?.items.length ? <div className="space-y-3"><MoreNotice page={query.data}/>{query.data.items.map((visit) => <Card key={visit.visitId}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><ClipboardCheck aria-hidden className="text-primary"/><div><p className="font-bold">{new Date(visit.visitDateTime).toLocaleString('th-TH')}</p><p className="text-sm text-slate-500">{visit.visitType || 'เยี่ยมตาม Care Plan'}</p></div></div><Status tone={visit.status === 'VERIFIED' ? 'success' : visit.status === 'SUBMITTED' ? 'warning' : 'neutral'}>{visit.status}</Status></div></Card>)}</div> : <Card><p className="text-center text-slate-500">ไม่มีงานเยี่ยมในขณะนี้</p></Card>}
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
    {query.isLoading ? <Loading/> : query.error ? <ErrorState message={query.error.message}/> : query.data?.items.length ? <div className="space-y-3"><MoreNotice page={query.data}/>{query.data.items.map((review) => <Card key={review.encounterId}><div className="flex gap-3"><FileText aria-hidden className="text-success"/><div><p className="font-bold">Visit {review.visitId}</p><p className="text-sm text-slate-600">ส่งโดย {review.performerId} · {new Date(review.endedAt).toLocaleString('th-TH')}</p></div></div></Card>)}</div> : <Card><p className="text-center text-slate-500">ไม่มีรายการรอตรวจ</p></Card>}
  </Page>;
}

export function Placeholder({ title }: { title: string }) {
  return <Page title={title} description="ส่วนควบคุมนี้ต้องตั้งค่าผ่านผู้ดูแลระบบของหน่วยงาน"><Card><p className="text-slate-600">ยังไม่มีการดำเนินการในหน้านี้</p></Card></Page>;
}
