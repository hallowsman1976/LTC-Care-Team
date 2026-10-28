import { useQuery } from '@tanstack/react-query';
import { ClipboardList, FileText, Layers, Pencil, Search, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEPENDENCY_OPTIONS, labelOf, PATIENT_STATUS_OPTIONS, type Actor, type Page } from '@smart-ltc/shared';
import { api } from '../lib/api';
import { Card, ErrorState, Loading, Status } from '../components/ui';
import { MoreNotice } from './WorkflowPages';

interface PatientSummary { patientId: string; localCode: string; hn?: string; fullName: string; age?: number; birthDate?: string; village?: string; subdistrict?: string; groupNumber?: number; dependencyStatus?: string; status: string }

function ageOf(patient: PatientSummary): number | null {
  if (typeof patient.age === 'number') return patient.age;
  if (!patient.birthDate) return null;
  const birth = new Date(patient.birthDate);
  if (Number.isNaN(birth.valueOf())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

const actionClass = 'inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-primary hover:bg-sky-50';

/** Editing, then (for a CM) the clinical workflow in order: ADL, then classification, then a care plan. */
function PatientActions({ patientId, clinical }: { patientId: string; clinical: boolean }) {
  const encoded = encodeURIComponent(patientId);
  return <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
    <Link to={`/patients/${encoded}/edit`} className={actionClass}><Pencil aria-hidden size={16}/>แก้ไขข้อมูล</Link>
    {clinical && <>
      <Link to={`/patients/${encoded}/adl/new`} className={actionClass}><ClipboardList aria-hidden size={16}/>ประเมิน ADL</Link>
      <Link to={`/patients/${encoded}/classification`} className={actionClass}><Layers aria-hidden size={16}/>จัดกลุ่ม</Link>
      <Link to={`/care-plans/new?patientId=${encoded}`} className={actionClass}><FileText aria-hidden size={16}/>สร้าง Care Plan</Link>
    </>}
  </div>;
}

export function Patients({ actor }: { actor: Actor }) {
  const [search, setSearch] = useState('');
  const canWrite = actor.capabilities.includes('patients:write');
  const query = useQuery({ queryKey: ['patients', actor.role], queryFn: () => api<Page<PatientSummary>>('/patients') });
  const patients = useMemo(() => (query.data?.items ?? []).filter((patient) => `${patient.fullName} ${patient.localCode} ${patient.hn ?? ''}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">ผู้รับบริการ</h2><p className="text-slate-600">{actor.role === 'CG' ? 'เฉพาะรายที่ได้รับมอบหมาย' : 'ทะเบียนของหน่วยบริการ'}</p></div>{canWrite && <Link to="/patients/new" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-2 font-semibold text-white"><UserPlus aria-hidden className="mr-2" size={19}/>เพิ่มผู้รับบริการ</Link>}</div>
    <label className="relative block"><span className="sr-only">ค้นหาผู้รับบริการ</span><Search aria-hidden className="absolute left-3 top-3 text-slate-400" size={20}/><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3" placeholder="ค้นหาชื่อ รหัส หรือ HN"/></label>
    {query.isLoading ? <Loading /> : query.error ? <ErrorState message={query.error.message}/> : patients.length === 0 ? <Card><p className="text-center text-slate-500">ไม่พบข้อมูล</p></Card> : <><MoreNotice page={query.data!}/><div className="grid gap-3 md:grid-cols-2">{patients.map((patient) => { const age = ageOf(patient); return <Card key={patient.patientId}><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{patient.fullName}</h3><p className="text-sm text-slate-600">{[patient.localCode, patient.hn ? `HN ${patient.hn}` : ''].filter(Boolean).join(' · ')}</p><p className="mt-2 text-sm">{age === null ? 'ไม่ระบุอายุ' : `อายุ ${age} ปี`}{patient.village ? ` · ${patient.village}` : ''}{patient.subdistrict ? ` ต.${patient.subdistrict}` : ''}</p></div><div className="flex flex-col items-end gap-1">{patient.status && patient.status !== 'ACTIVE' && <Status tone="neutral">{labelOf(PATIENT_STATUS_OPTIONS, patient.status) || patient.status}</Status>}{patient.groupNumber && <Status tone="neutral">กลุ่ม {patient.groupNumber}</Status>}{patient.dependencyStatus && <Status tone={patient.dependencyStatus === 'BEDBOUND' ? 'danger' : patient.dependencyStatus === 'HOMEBOUND' ? 'warning' : 'success'}>{labelOf(DEPENDENCY_OPTIONS, patient.dependencyStatus).replace(/ \(.*\)$/, '')}</Status>}</div></div>{canWrite && <PatientActions patientId={patient.patientId} clinical={actor.capabilities.includes('adl:approve')}/>}</Card>; })}</div></>}
  </div>;
}

