import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorState, Loading } from '../components/ui';
import { Dashboard } from '../features/Dashboard';
import { Patients } from '../features/Patients';
import { Alerts, Calendar, Placeholder, Reviews, Visits } from '../features/WorkflowPages';
import { browserSupported } from '../lib/browser';
import { getMe } from '../lib/api';
import { ApiError } from '../lib/api';
import { Login } from '../features/Login';
import { Layout } from './Layout';
import { Assignments, Caregivers, PatientImport } from '../features/Admin';
import { VisitRecordForm } from '../features/VisitRecordForm';
import { AdlForm, CarePlanForm, ClassificationForm, PatientForm } from '../features/ClinicalForms';

function UnsupportedBrowser() {
  return <main className="mx-auto max-w-lg p-6"><div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-bold text-red-900">เบราว์เซอร์ไม่รองรับ</h1><p className="mt-2 text-red-800">กรุณาอัปเดต Chrome/Edge 109+, Firefox 115 ESR+ หรือ Safari/iOS 16.4+ ระบบจะไม่โหลดข้อมูลผู้รับบริการบนเบราว์เซอร์นี้</p></div></main>;
}

export function App() {
  // A 401 is an answer, not a transient failure: show sign-in at once instead of retrying.
  const me = useQuery({ queryKey: ['me'], queryFn: getMe, retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1 });
  if (!browserSupported()) return <UnsupportedBrowser />;
  // isPending (not isLoading): a paused query has no data yet but is not fetching either.
  if (me.isPending) return <Loading />;
  if (me.error instanceof ApiError && me.error.code === 'UNAUTHENTICATED') return <Login />;
  if (me.error) return <main className="p-6"><ErrorState message={me.error.message}/></main>;
  const actor = me.data;
  return <Routes><Route element={<Layout actor={actor}/>}>
    <Route index element={<Dashboard actor={actor}/>}/>
    <Route path="patients" element={<Patients actor={actor}/>}/>
    <Route path="visits" element={<Visits actor={actor}/>}/><Route path="calendar" element={<Calendar/>}/>
    <Route path="alerts" element={<Alerts/>}/><Route path="reviews" element={<Reviews/>}/>
    <Route path="patients/new" element={<PatientForm/>}/>
    <Route path="patients/:id/adl/new" element={<AdlForm/>}/>
    <Route path="patients/:id/classification" element={<ClassificationForm/>}/>
    <Route path="care-plans/new" element={<CarePlanForm/>}/>
    <Route path="visits/:id" element={<VisitRecordForm/>}/>
    <Route path="admin/assignments" element={<Assignments/>}/>
    <Route path="admin/caregivers" element={<Caregivers/>}/>
    <Route path="admin/import" element={<PatientImport/>}/>
    <Route path="settings/users" element={<Placeholder title="ผู้ใช้งานและสิทธิ์"/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Route></Routes>;
}

