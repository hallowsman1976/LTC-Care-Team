import { useQuery } from '@tanstack/react-query';
import type { Actor } from '@smart-ltc/shared';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, FilePenLine, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, facilityName, isDemoMode } from '../lib/api';
import { Card, ErrorState, Loading, VisitStatusBadge } from '../components/ui';

interface FollowUpVisit { visitId: string; visitDateTime: string; visitType?: string; status: string; patientName?: string }
// followUpVisits is optional: the web app can reach users before the Apps Script deployment does.
interface DashboardData { dueToday: number; overdue: number; reviewQueue: number; highRiskAlerts: number; drafts: number; followUpVisits?: FollowUpVisit[] }

const visitDate = (value: string) => new Date(value).toLocaleDateString('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' });
const visitTypeOf = (visit: FollowUpVisit) => visit.visitType || 'เยี่ยมตาม Care Plan';

function Hero({ actor }: { actor: Actor }) {
  return <section className="rounded-2xl bg-gradient-to-r from-navy to-primary p-5 text-white shadow-sm md:p-8">
    <span className="inline-flex rounded-md bg-white/15 px-2 py-1 text-xs font-bold tracking-wide">SMART LTC CARE</span>
    <h2 className="mt-3 text-2xl font-bold md:text-3xl">ภาพรวมวันนี้</h2>
    <p className="mt-1 font-semibold">{facilityName}</p>
    <p className="mt-2 hidden max-w-2xl text-blue-50 sm:block">{isDemoMode ? 'ข้อมูลจำลองเพื่อทดสอบ workflow' : 'ติดตามงานเยี่ยม การตรวจทาน และการแจ้งเตือนของหน่วยบริการ'}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      {actor.capabilities.includes('patients:write') && <Link to="/patients/new" className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 font-semibold text-primary hover:bg-blue-50"><Plus aria-hidden className="mr-2" size={18}/>เพิ่มผู้รับบริการ</Link>}
      {actor.capabilities.includes('patients:read') && <Link to="/visits" className="inline-flex min-h-11 items-center rounded-xl border border-white/50 bg-white/10 px-4 font-semibold text-white hover:bg-white/20">ดูงานเยี่ยมทั้งหมด</Link>}
    </div>
  </section>;
}

function FollowUpTable({ visits }: { visits: FollowUpVisit[] }) {
  return <Card className="overflow-hidden !p-0">
    <div className="flex items-center justify-between gap-3 p-4 md:p-5">
      <div><h3 className="text-lg font-bold">งานเยี่ยมที่ต้องติดตาม</h3><p className="text-sm text-slate-600">งานที่ยังไม่ปิดไม่เกิน 5 รายการ เรียงงานเก่าสุดขึ้นก่อน</p></div>
      <Link to="/visits" className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary">ดูทั้งหมด<ChevronRight aria-hidden size={18}/></Link>
    </div>
    {visits.length === 0 ? <p className="border-t border-slate-200 p-6 text-center text-slate-500">ไม่มีงานเยี่ยมค้าง</p> : <>
      <table className="hidden w-full text-left md:table">
        <thead className="border-t border-slate-200 bg-slate-50 text-sm text-slate-600"><tr><th scope="col" className="px-5 py-3 font-semibold">ผู้รับบริการ</th><th scope="col" className="px-5 py-3 font-semibold">ประเภทการเยี่ยม</th><th scope="col" className="px-5 py-3 font-semibold">วันนัด</th><th scope="col" className="px-5 py-3 font-semibold">สถานะ</th></tr></thead>
        <tbody>{visits.map((visit) => <tr key={visit.visitId} className="border-t border-slate-200"><td className="px-5 py-4 font-semibold">{visit.patientName || '–'}</td><td className="px-5 py-4 text-slate-700">{visitTypeOf(visit)}</td><td className="whitespace-nowrap px-5 py-4 text-slate-700">{visitDate(visit.visitDateTime)}</td><td className="px-5 py-4"><VisitStatusBadge status={visit.status}/></td></tr>)}</tbody>
      </table>
      <ul className="md:hidden">{visits.map((visit) => <li key={visit.visitId} className="flex items-start justify-between gap-3 border-t border-slate-200 p-4"><div className="min-w-0"><p className="font-semibold">{visit.patientName || '–'}</p><p className="text-sm text-slate-600">{visitTypeOf(visit)}</p><p className="text-sm text-slate-600">วันนัด {visitDate(visit.visitDateTime)}</p></div><div className="shrink-0"><VisitStatusBadge status={visit.status}/></div></li>)}</ul>
    </>}
  </Card>;
}

export function Dashboard({ actor }: { actor: Actor }) {
  const query = useQuery({ queryKey: ['dashboard', actor.role], queryFn: () => api<DashboardData>('/dashboard') });
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState message={query.error.message} />;
  const data = query.data!;
  const cards = actor.role === 'CG'
    ? [{ label: 'งานวันนี้', value: data.dueToday, icon: Clock3, text: 'text-primary', tile: 'bg-blue-50' }, { label: 'ฉบับร่างในเครื่อง', value: data.drafts, icon: FilePenLine, text: 'text-warning', tile: 'bg-amber-50' }]
    : [{ label: 'ครบกำหนดวันนี้', value: data.dueToday, icon: Clock3, text: 'text-primary', tile: 'bg-blue-50' }, { label: 'เกินกำหนด', value: data.overdue, icon: AlertTriangle, text: 'text-danger', tile: 'bg-red-50' }, { label: 'รอตรวจ', value: data.reviewQueue, icon: CheckCircle2, text: 'text-success', tile: 'bg-green-50' }, { label: 'ความเสี่ยงสูง', value: data.highRiskAlerts, icon: AlertTriangle, text: 'text-danger', tile: 'bg-red-50' }];
  return <div className="space-y-6">
    {actor.role === 'CG'
      ? <div><h2 className="text-2xl font-bold">งานของฉัน</h2><p className="text-slate-600">{isDemoMode ? 'ข้อมูลจำลองเพื่อทดสอบ workflow' : 'ข้อมูลปัจจุบันของหน่วยบริการ'}</p></div>
      : <Hero actor={actor}/>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(({ label, value, icon: Icon, text, tile }) => <Card key={label}><div className="flex items-start justify-between gap-2"><div><p className="text-sm text-slate-600">{label}</p><p className={`mt-2 text-3xl font-bold ${text}`}>{value}</p></div><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tile}`}><Icon aria-hidden className={text} size={22}/></span></div></Card>)}</div>
    {data.followUpVisits && <FollowUpTable visits={data.followUpVisits}/>}
  </div>;
}
