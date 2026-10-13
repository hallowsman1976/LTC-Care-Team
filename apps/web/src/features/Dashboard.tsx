import { useQuery } from '@tanstack/react-query';
import type { Actor } from '@smart-ltc/shared';
import { AlertTriangle, CheckCircle2, Clock3, FilePenLine } from 'lucide-react';
import { api, isDemoMode } from '../lib/api';
import { Card, ErrorState, Loading, Status } from '../components/ui';

interface DashboardData { dueToday: number; overdue: number; reviewQueue: number; highRiskAlerts: number; drafts: number }

export function Dashboard({ actor }: { actor: Actor }) {
  const query = useQuery({ queryKey: ['dashboard', actor.role], queryFn: () => api<DashboardData>('/dashboard') });
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState message={query.error.message} />;
  const data = query.data!;
  const cards = actor.role === 'CG'
    ? [{ label: 'งานวันนี้', value: data.dueToday, icon: Clock3, tone: 'text-primary' }, { label: 'ฉบับร่างในเครื่อง', value: data.drafts, icon: FilePenLine, tone: 'text-warning' }]
    : [{ label: 'ครบกำหนดวันนี้', value: data.dueToday, icon: Clock3, tone: 'text-primary' }, { label: 'เกินกำหนด', value: data.overdue, icon: AlertTriangle, tone: 'text-danger' }, { label: 'รอตรวจ', value: data.reviewQueue, icon: CheckCircle2, tone: 'text-success' }, { label: 'ความเสี่ยงสูง', value: data.highRiskAlerts, icon: AlertTriangle, tone: 'text-danger' }];
  return <div className="space-y-6">
    <div><h2 className="text-2xl font-bold">{actor.role === 'CG' ? 'งานของฉัน' : 'ภาพรวมวันนี้'}</h2><p className="text-slate-600">{isDemoMode ? 'ข้อมูลจำลองเพื่อทดสอบ workflow' : 'ข้อมูลปัจจุบันของหน่วยบริการ'}</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(({ label, value, icon: Icon, tone }) => <Card key={label}><div className="flex items-start justify-between"><div><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div><Icon aria-hidden className={tone}/></div></Card>)}</div>
    <Card><div className="flex items-center justify-between"><div><h3 className="font-bold">สถานะระบบ</h3><p className="text-sm text-slate-600">{isDemoMode ? 'ยังไม่มีการเชื่อมข้อมูลจริงหรือช่องทาง LINE' : 'เชื่อมข้อมูลหน่วยบริการ · การใช้งานถูกบันทึกเพื่อการตรวจสอบ'}</p></div><Status tone={isDemoMode ? 'warning' : 'success'}>{isDemoMode ? 'DEMO' : 'PILOT'}</Status></div></Card>
  </div>;
}

