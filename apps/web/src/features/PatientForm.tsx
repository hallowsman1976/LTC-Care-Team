import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, LocateFixed, MapPin, Save, UserPlus } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Controller, useForm, type DefaultValues, type UseFormReturn } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import type { z } from 'zod';
import {
  COMMON_DISEASES, DEPENDENCY_OPTIONS, dependencyFromAdl, MENTAL_HEALTH_OPTIONS, PATIENT_STATUS_OPTIONS, patientCreateSchema, patientUpdateSchema,
  PPS_OPTIONS, RELATIONSHIP_OPTIONS, RIGHT_TYPE_OPTIONS, SEX_OPTIONS, TAI_GROUP_OPTIONS, labelOf, type Actor, type Page as ListPage
} from '@smart-ltc/shared';
import { api, isDemoMode, post, todayInBangkok } from '../lib/api';
import { fromIsoDate } from '../lib/thaiDate';
import { ThaiDatePicker } from '../components/ThaiDatePicker';
import { Button, Card, ErrorState, Loading, Status } from '../components/ui';
import { fieldClass, labelClass, messageOf } from './adminShared';
import { useCaregivers } from './Caregivers';

type CreateForm = z.infer<typeof patientCreateSchema>;
type UpdateForm = z.infer<typeof patientUpdateSchema>;
/** The fields both forms share, under the same names, so one set of inputs serves both. */
type FieldsForm = Omit<CreateForm, 'legalBasis' | 'privacyNoticeVersion' | 'duplicateOverrideReason'>;
interface Candidate { patientId: string; hn: string; fullName: string; birthDate: string }
interface CreateResult { status: 'CREATED' | 'POTENTIAL_DUPLICATE'; candidates?: Candidate[] }
interface UpdateResult { recordVersion: number; status: string; cancelledVisits: number }
interface StaffUser { userId: string; displayName: string; role: string; enabled: boolean }
type PatientDetail = Record<string, unknown> & { patientId: string; fullName: string; hn: string; status: string; recordVersion: number; cidLast4?: string; caregiverId?: string };

// Units register people from the same few subdistricts: remember the last area to save typing.
const AREA_KEY = 'smart-ltc-last-area';
type Area = Pick<CreateForm, 'subdistrict' | 'district' | 'province'>;
function lastArea(): Area {
  try { return JSON.parse(localStorage.getItem(AREA_KEY) ?? '{}') as Area; } catch { return {}; }
}
function rememberArea(area: Area): void {
  try { localStorage.setItem(AREA_KEY, JSON.stringify(area)); } catch { /* private mode: nothing to remember */ }
}

const OPTIONAL_FIELDS = ['phone', 'villageNo', 'villageName', 'subdistrict', 'district', 'province', 'latitude', 'longitude', 'mainCaregiverName', 'mainCaregiverPhone',
  'relationship', 'rightType', 'diseases', 'adlScore', 'dependencyStatus', 'taiGroup', 'ppsScore', 'mentalHealthStatus', 'careManagerId', 'caregiverId'] as const;

/**
 * Every field gets an explicit empty value: reset() leaves an input untouched when its new value is
 * undefined, so the previous patient's choices would otherwise carry over to the next one.
 * Empty choices and numbers are read as "not given" by the schema.
 */
const emptyPatient = (): DefaultValues<CreateForm> => ({
  ...Object.fromEntries(OPTIONAL_FIELDS.map((name) => [name, ''])),
  hn: '', cid: '', fullName: '', sex: 'UNKNOWN', birthDate: '', address: '', registerDate: todayInBangkok(), ...lastArea(),
  duplicateOverrideReason: undefined, legalBasis: '', privacyNoticeVersion: import.meta.env.VITE_PRIVACY_NOTICE_VERSION || ''
} as unknown as DefaultValues<CreateForm>);

/** A saved patient as form values: blanks for anything missing, the CID left empty (unchanged). */
const fromDetail = (detail: PatientDetail): DefaultValues<UpdateForm> => ({
  ...Object.fromEntries(OPTIONAL_FIELDS.map((name) => [name, detail[name] === undefined || detail[name] === null ? '' : String(detail[name])])),
  patientId: detail.patientId, recordVersion: detail.recordVersion, cid: '', status: detail.status || 'ACTIVE', statusNote: '',
  localCode: String(detail.localCode ?? ''), hn: detail.hn, fullName: detail.fullName, sex: String(detail.sex || 'UNKNOWN'), birthDate: String(detail.birthDate ?? ''),
  address: String(detail.address ?? ''), village: String(detail.village ?? ''), registerDate: String(detail.registerDate ?? '')
} as unknown as DefaultValues<UpdateForm>);

function ageOn(birthDate: string): number | null {
  const birth = fromIsoDate(birthDate);
  if (!birth) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="grid gap-4 border-t border-slate-100 pt-5 first:border-0 first:pt-0 md:grid-cols-2">
    <div className="md:col-span-2"><h3 className="text-base font-bold text-slate-900">{title}</h3>{hint && <p className="text-sm text-slate-500">{hint}</p>}</div>
    {children}
  </section>;
}

const Optional = () => <span className="font-normal text-slate-500">(ไม่บังคับ)</span>;
function FieldError({ message }: { message?: string | undefined }) { return message ? <span className="text-xs text-danger">{message}</span> : null; }

// forwardRef: react-hook-form writes to the <select> through its ref (auto-fill and reset).
const Choice = forwardRef<HTMLSelectElement, { options: ReadonlyArray<readonly [string, string]>; placeholder?: string } & SelectHTMLAttributes<HTMLSelectElement>>(
  function Choice({ options, placeholder = 'ไม่ระบุ', ...props }, ref) {
    return <select ref={ref} {...props} className={fieldClass}><option value="">{placeholder}</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
  }
);

const invalidForm = 'ข้อมูลยังไม่ครบหรือไม่ถูกต้อง กรุณาตรวจช่องที่มีข้อความสีแดง';

/** Sections 1–6, the same inputs on the add and edit pages. */
function PatientFields({ form, actor, cidLabel, cidHint, caregiverLocked, onError }: {
  form: UseFormReturn<FieldsForm>; actor: Actor; cidLabel: string; cidHint?: string | undefined; caregiverLocked?: string | undefined; onError: (message: string) => void;
}) {
  const canAssign = actor.capabilities.includes('assignments:manage');
  const caregivers = useCaregivers();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<ListPage<StaffUser>>('/admin/users'), enabled: actor.capabilities.includes('users:manage') });
  const careManagers = (users.data?.items ?? []).filter((user) => user.role === 'CM' && user.enabled);
  const activeCaregivers = (caregivers.data?.items ?? []).filter((caregiver) => caregiver.enabled);
  const [locating, setLocating] = useState(false);
  const errors = form.formState.errors;

  // The staff lists arrive after the form sets its values, and a <select> cannot show a value it has
  // no option for yet: re-apply the saved choice once the options exist.
  useEffect(() => { form.setValue('caregiverId', form.getValues('caregiverId')); }, [activeCaregivers.length, form]);
  useEffect(() => { form.setValue('careManagerId', form.getValues('careManagerId')); }, [careManagers.length, form]);
  const [birthDate, adlScore, latitude, longitude, diseases] = form.watch(['birthDate', 'adlScore', 'latitude', 'longitude', 'diseases']);
  const age = birthDate ? ageOn(birthDate) : null;

  // Suggest the dependency group when the ADL score is changed (not for the saved score on load).
  const previousAdl = useRef(String(adlScore ?? ''));
  useEffect(() => {
    const typed = String(adlScore ?? '');
    if (typed === previousAdl.current) return;
    previousAdl.current = typed;
    const score = Number(typed);
    if (typed !== '' && Number.isInteger(score) && score >= 0 && score <= 20) form.setValue('dependencyStatus', dependencyFromAdl(score));
  }, [adlScore, form]);

  const chosenDiseases = String(diseases ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const toggleDisease = (name: string) => {
    const next = chosenDiseases.includes(name) ? chosenDiseases.filter((item) => item !== name) : [...chosenDiseases, name];
    form.setValue('diseases', next.join(', '), { shouldDirty: true });
  };

  const locate = () => {
    if (!navigator.geolocation) { onError('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      form.setValue('latitude', Number(position.coords.latitude.toFixed(6)), { shouldValidate: true, shouldDirty: true });
      form.setValue('longitude', Number(position.coords.longitude.toFixed(6)), { shouldValidate: true, shouldDirty: true });
      setLocating(false);
    }, () => { onError('ระบุตำแหน่งไม่ได้ กรุณาอนุญาตการเข้าถึงตำแหน่ง หรือกรอกพิกัดเอง'); setLocating(false); }, { enableHighAccuracy: true, timeout: 15_000 });
  };
  const mapsUrl = latitude !== undefined && longitude !== undefined && String(latitude) !== '' && String(longitude) !== '' ? `https://www.google.com/maps?q=${latitude},${longitude}` : '';

  return <>
    <Section title="1. ข้อมูลทั่วไป">
      <label className={labelClass}>HN<input {...form.register('hn')} className={fieldClass} autoComplete="off"/><FieldError message={errors.hn?.message}/></label>
      <label className={labelClass}>{cidLabel}<input {...form.register('cid')} inputMode="numeric" maxLength={13} className={fieldClass} autoComplete="off"/>{cidHint && <span className="block text-xs font-normal text-slate-500">{cidHint}</span>}<FieldError message={errors.cid?.message}/></label>
      <label className={`${labelClass} md:col-span-2`}>{isDemoMode ? 'ชื่อ–สกุล (สมมติ)' : 'ชื่อ–สกุล'}<input {...form.register('fullName')} className={fieldClass} autoComplete="off" placeholder="เช่น นางสมใจ ใจดี"/><FieldError message={errors.fullName?.message}/></label>
      <label className={labelClass}>เพศ<select {...form.register('sex')} className={fieldClass}>{SEX_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className={labelClass}>วันเกิด<Controller control={form.control} name="birthDate" render={({ field }) => <ThaiDatePicker value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} maxDate={todayInBangkok()} invalid={Boolean(errors.birthDate)} className={fieldClass}/>}/><FieldError message={errors.birthDate?.message}/></label>
        <div className={labelClass}>อายุ<p className="mt-1 flex min-h-[44px] min-w-20 items-center justify-center rounded-xl bg-slate-100 px-3 font-bold">{age === null ? '–' : `${age} ปี`}</p></div>
      </div>
      <label className={labelClass}>เบอร์โทร <Optional/><input type="tel" {...form.register('phone')} className={fieldClass} placeholder="08xxxxxxxx"/></label>
      <label className={labelClass}>วันที่ลงทะเบียน<Controller control={form.control} name="registerDate" render={({ field }) => <ThaiDatePicker value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} maxDate={todayInBangkok()} minYear={2000} className={fieldClass}/>}/></label>
    </Section>

    <Section title="2. ที่อยู่และพิกัดบ้าน" hint="ใช้ในการเดินทางไปเยี่ยมบ้าน">
      <label className={`${labelClass} md:col-span-2`}>บ้านเลขที่ / ที่อยู่<input {...form.register('address')} className={fieldClass} placeholder="เช่น 12/3 ซอย…"/><FieldError message={errors.address?.message}/></label>
      <label className={labelClass}>หมู่ที่<input {...form.register('villageNo')} inputMode="numeric" className={fieldClass} placeholder="เช่น 2"/><FieldError message={errors.villageNo?.message}/></label>
      <label className={labelClass}>ชื่อหมู่บ้าน <Optional/><input {...form.register('villageName')} className={fieldClass} placeholder="เช่น บ้านหนองบัว"/></label>
      <label className={labelClass}>ตำบล<input {...form.register('subdistrict')} className={fieldClass}/></label>
      <label className={labelClass}>อำเภอ<input {...form.register('district')} className={fieldClass}/></label>
      <label className={labelClass}>จังหวัด<input {...form.register('province')} className={fieldClass}/></label>
      <div className="md:col-span-2 grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className={labelClass}>ละติจูด<input {...form.register('latitude')} inputMode="decimal" className={fieldClass} placeholder="เช่น 16.432100"/><FieldError message={errors.latitude?.message}/></label>
        <label className={labelClass}>ลองจิจูด<input {...form.register('longitude')} inputMode="decimal" className={fieldClass} placeholder="เช่น 102.823600"/><FieldError message={errors.longitude?.message}/></label>
        <button type="button" onClick={locate} disabled={locating} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-primary hover:bg-sky-50 disabled:opacity-60"><LocateFixed aria-hidden size={18}/>{locating ? 'กำลังหาตำแหน่ง…' : 'ใช้ตำแหน่งปัจจุบัน'}</button>
        <p className="text-sm text-slate-500 sm:col-span-3">กดเมื่ออยู่ที่บ้านผู้รับบริการ {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary underline"><MapPin aria-hidden size={14}/>ดูบนแผนที่</a>}</p>
      </div>
    </Section>

    <Section title="3. ผู้ดูแลหลักในครอบครัว" hint="ญาติหรือผู้ที่ดูแลประจำ สำหรับติดต่อและนัดเยี่ยม">
      <label className={labelClass}>ชื่อ–สกุลผู้ดูแลหลัก <Optional/><input {...form.register('mainCaregiverName')} className={fieldClass}/></label>
      <label className={labelClass}>เบอร์โทรผู้ดูแลหลัก <Optional/><input type="tel" {...form.register('mainCaregiverPhone')} className={fieldClass} placeholder="08xxxxxxxx"/><FieldError message={errors.mainCaregiverPhone?.message}/></label>
      <label className={labelClass}>ความสัมพันธ์กับผู้รับบริการ<Choice options={RELATIONSHIP_OPTIONS} {...form.register('relationship')}/></label>
    </Section>

    <Section title="4. สิทธิการรักษาและโรคประจำตัว">
      <label className={labelClass}>สิทธิการรักษา<Choice options={RIGHT_TYPE_OPTIONS} {...form.register('rightType')}/></label>
      <div className="md:col-span-2">
        <label className={labelClass}>โรคประจำตัว <Optional/><input {...form.register('diseases')} className={fieldClass} placeholder="กดเลือกด้านล่าง หรือพิมพ์ คั่นด้วยจุลภาค (,)"/></label>
        <div className="mt-2 flex flex-wrap gap-2">{COMMON_DISEASES.map((name) => {
          const chosen = chosenDiseases.includes(name);
          return <button key={name} type="button" aria-pressed={chosen} onClick={() => toggleDisease(name)} className={`min-h-10 rounded-lg border px-3 text-sm ${chosen ? 'border-primary bg-sky-50 font-semibold text-primary' : 'border-slate-300 hover:bg-sky-50'}`}>{chosen ? '✓ ' : ''}{name}</button>;
        })}</div>
      </div>
    </Section>

    <Section title="5. การประเมินแรกรับ" hint="ค่าเริ่มต้นเมื่อลงทะเบียน การประเมิน ADL อย่างเป็นทางการยังทำผ่านเมนู “ประเมิน ADL” ตามเดิม">
      <label className={labelClass}>คะแนน ADL (0–20)<input type="number" min={0} max={20} inputMode="numeric" {...form.register('adlScore')} className={fieldClass}/><FieldError message={errors.adlScore?.message && 'ใส่ 0–20'}/></label>
      <label className={labelClass}>ภาวะพึ่งพิง<Choice options={DEPENDENCY_OPTIONS} {...form.register('dependencyStatus')}/><span className="text-xs font-normal text-slate-500">เลือกให้อัตโนมัติเมื่อกรอกคะแนน ADL เปลี่ยนเองได้</span></label>
      <label className={labelClass}>กลุ่ม TAI<Choice options={TAI_GROUP_OPTIONS} {...form.register('taiGroup')}/></label>
      <label className={labelClass}>คะแนน PPS<Choice options={PPS_OPTIONS.map((value) => [String(value), `${value}%`] as const)} {...form.register('ppsScore')}/></label>
      <label className={labelClass}>สุขภาพจิต<Choice options={MENTAL_HEALTH_OPTIONS} {...form.register('mentalHealthStatus')}/></label>
    </Section>

    <Section title="6. ผู้รับผิดชอบ">
      <label className={labelClass}>ผู้จัดการการดูแล (CM)
        {careManagers.length ? <select {...form.register('careManagerId')} className={fieldClass}>{careManagers.map((user) => <option key={user.userId} value={user.userId}>{user.displayName}{user.userId === actor.userId ? ' (ฉัน)' : ''}</option>)}</select>
          : <p className={`${fieldClass} bg-slate-50 text-slate-600`}>{actor.role === 'CM' ? 'ท่าน (ผู้ลงทะเบียน)' : 'ไม่ระบุ'}</p>}
      </label>
      {canAssign && <label className={labelClass}>ผู้ดูแล (CG) <Optional/>
        <Choice options={activeCaregivers.map((caregiver) => [caregiver.userId, `${caregiver.displayName} (ดูแล ${caregiver.activePatients} ราย)`] as const)} placeholder="ยังไม่มอบหมาย" disabled={Boolean(caregiverLocked)} {...form.register('caregiverId')}/>
        <span className="text-xs font-normal text-slate-500">{caregiverLocked ?? 'มอบหมายภายหลังได้ที่เมนู “มอบหมายงาน CG”'}</span>
      </label>}
    </Section>
  </>;
}

export function PatientForm({ actor }: { actor: Actor }) {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{ fullName: string } | null>(null);
  const [duplicates, setDuplicates] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const form = useForm<CreateForm>({ resolver: zodResolver(patientCreateSchema), defaultValues: { ...emptyPatient(), careManagerId: actor.role === 'CM' ? actor.userId : '' } });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    setError(''); setCreated(null);
    try {
      const result = await post<CreateResult>('/patients', values);
      if (result.status === 'POTENTIAL_DUPLICATE') { setDuplicates(result.candidates ?? []); return; }
      rememberArea({ subdistrict: values.subdistrict, district: values.district, province: values.province });
      setCreated({ fullName: values.fullName });
      setDuplicates([]);
      form.reset({ ...emptyPatient(), careManagerId: values.careManagerId });
      await queryClient.invalidateQueries();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (failure) { setError(messageOf(failure)); }
  }, () => setError(invalidForm));

  return <div className="mx-auto max-w-4xl space-y-5">
    <div><h2 className="text-2xl font-bold">เพิ่มผู้รับบริการ</h2><p className="text-slate-600">{isDemoMode ? 'ห้ามกรอกข้อมูลบุคคลจริงในระบบ DEMO' : 'กรอกเฉพาะข้อมูลที่จำเป็นตามฐานการประมวลผลที่หน่วยบริการอนุมัติ'}</p></div>
    {created && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-green-900">
      <CheckCircle2 aria-hidden/><p className="flex-1 font-bold">บันทึก {created.fullName} แล้ว ระบบเปิดช่วงการดูแลให้ พร้อมประเมิน ADL</p>
      <Link to="/patients" className="font-semibold underline">ไปที่รายชื่อผู้รับบริการ</Link>
    </div>}
    <Card>
      <form onSubmit={submit} noValidate className="space-y-6">
        <PatientFields form={form as unknown as UseFormReturn<FieldsForm>} actor={actor} onError={setError} cidLabel={isDemoMode ? 'เลขบัตรประชาชน (สมมติ) 13 หลัก' : 'เลขบัตรประชาชน 13 หลัก'}/>

        {!isDemoMode && <Section title="7. ฐานการประมวลผลข้อมูล">
          <label className={labelClass}>ฐานการประมวลผล<select {...form.register('legalBasis')} className={fieldClass}><option value="">กรุณาเลือก</option><option value="PUBLIC_HEALTH">ภารกิจด้านสาธารณสุข</option><option value="MEDICAL_CARE">การให้บริการด้านสุขภาพ</option><option value="LEGAL_OBLIGATION">หน้าที่ตามกฎหมาย</option><option value="EXPLICIT_CONSENT">ความยินยอมโดยชัดแจ้ง</option></select></label>
          <label className={labelClass}>เวอร์ชันประกาศความเป็นส่วนตัว<input {...form.register('privacyNoticeVersion')} readOnly className={fieldClass}/></label>
        </Section>}

        {duplicates.length > 0 && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p className="font-bold">พบผู้รับบริการที่ชื่อและวันเกิดตรงกัน อาจเป็นคนเดียวกัน</p>
          <ul className="list-disc pl-5 text-sm">{duplicates.map((candidate) => <li key={candidate.patientId}>{candidate.fullName} · HN {candidate.hn}</li>)}</ul>
          <label className={labelClass}>ถ้าไม่ใช่คนเดียวกัน ระบุเหตุผลแล้วบันทึกอีกครั้ง<textarea {...form.register('duplicateOverrideReason')} rows={2} className={fieldClass} placeholder="อย่างน้อย 10 ตัวอักษร"/><FieldError message={errors.duplicateOverrideReason?.message && 'อย่างน้อย 10 ตัวอักษร'}/></label>
        </div>}

        <div className="space-y-3 border-t border-slate-100 pt-4">
          <Button type="submit" disabled={form.formState.isSubmitting}><UserPlus aria-hidden className="mr-2" size={18}/>{form.formState.isSubmitting ? 'กำลังบันทึก…' : 'บันทึกผู้รับบริการ'}</Button>
          {error && <ErrorState message={error}/>}
        </div>
      </form>
    </Card>
  </div>;
}

export function PatientEdit({ actor }: { actor: Actor }) {
  const { id: patientId = '' } = useParams();
  const detail = useQuery({ queryKey: ['patient', patientId], queryFn: () => post<PatientDetail>('/patients/get', { patientId }) });
  // Kept here: saving reloads the patient, which remounts the form with the new record version.
  const [saved, setSaved] = useState('');
  return <div className="mx-auto max-w-4xl space-y-5">
    <div><h2 className="text-2xl font-bold">แก้ไขข้อมูลผู้รับบริการ</h2><p className="text-slate-600">แก้ไขข้อมูลทั่วไป ที่อยู่ ผู้ดูแล การประเมินแรกรับ และสถานะการรับบริการ</p></div>
    <Link to="/patients" className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft aria-hidden size={16}/>กลับไปหน้ารายชื่อ</Link>
    {saved && <p role="status" className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-green-900"><CheckCircle2 aria-hidden size={18} className="mt-0.5 shrink-0"/>{saved}</p>}
    {detail.isLoading ? <Loading/> : detail.error ? <ErrorState message={detail.error.message}/> : <EditForm key={`${detail.data!.patientId}:${detail.data!.recordVersion}`} actor={actor} detail={detail.data!} onSaved={setSaved}/>}
  </div>;
}

function EditForm({ actor, detail, onSaved }: { actor: Actor; detail: PatientDetail; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const form = useForm<UpdateForm>({ resolver: zodResolver(patientUpdateSchema), defaultValues: fromDetail(detail) });
  const status = form.watch('status');
  const leaving = detail.status === 'ACTIVE' && status !== 'ACTIVE';
  const returning = detail.status !== 'ACTIVE' && status === 'ACTIVE';

  const submit = form.handleSubmit(async (values) => {
    setError(''); onSaved('');
    try {
      const result = await post<UpdateResult>('/patients/update', values);
      onSaved([`บันทึกข้อมูล ${values.fullName} แล้ว`, result.cancelledVisits ? `ยกเลิกนัดเยี่ยมที่ยังไม่ถึง ${result.cancelledVisits} นัด` : ''].filter(Boolean).join(' · '));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await queryClient.invalidateQueries();
    } catch (failure) { setError(messageOf(failure)); }
  }, () => setError(invalidForm));

  return <Card>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-lg font-bold">{detail.fullName}</p><p className="text-sm text-slate-600">HN {detail.hn}</p></div>
      <Status tone={detail.status === 'ACTIVE' ? 'success' : 'neutral'}>{labelOf(PATIENT_STATUS_OPTIONS, detail.status) || detail.status}</Status>
    </div>
    <form onSubmit={submit} noValidate className="space-y-6">
      <PatientFields form={form as unknown as UseFormReturn<FieldsForm>} actor={actor} onError={setError}
        cidLabel="เลขบัตรประชาชนใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
        cidHint={detail.cidLast4 ? `ที่บันทึกไว้ลงท้ายด้วย ${detail.cidLast4}` : 'ยังไม่ได้บันทึกเลขบัตรประชาชน'}
        caregiverLocked={status !== 'ACTIVE' ? 'ผู้ที่ไม่ได้รับบริการแล้วจะไม่มี CG' : undefined}/>

      <Section title="7. สถานะการรับบริการ">
        <label className={labelClass}>สถานะ<select {...form.register('status')} className={fieldClass}>{PATIENT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {(leaving || returning) && <label className={labelClass}>หมายเหตุ <Optional/><input {...form.register('statusNote')} className={fieldClass} placeholder={status === 'DECEASED' ? 'เช่น วันที่และสถานที่' : status === 'MOVED' ? 'เช่น ย้ายไปอยู่กับบุตรที่…' : 'เหตุผล'}/></label>}
        {leaving && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">เมื่อบันทึก ระบบจะปิดช่วงการดูแล ยกเลิกการมอบหมาย CG และยกเลิกนัดเยี่ยมที่ยังไม่ถึงของรายนี้ ประวัติการเยี่ยมเดิมยังอยู่ครบ</p>}
        {returning && <p role="note" className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900 md:col-span-2">เมื่อบันทึก ระบบจะเปิดช่วงการดูแลใหม่ ประเมิน ADL และมอบหมาย CG ได้อีกครั้ง</p>}
      </Section>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <Button type="submit" disabled={form.formState.isSubmitting}><Save aria-hidden className="mr-2" size={18}/>{form.formState.isSubmitting ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</Button>
        <Link to="/patients" className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-slate-600 hover:bg-slate-100">ยกเลิก</Link>
      </div>
      {error && <ErrorState message={error}/>}
    </form>
  </Card>;
}
