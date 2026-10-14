import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, CheckCircle2, KeyRound, Pencil, Plus, Trash2, UserPlus, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useFieldArray, useForm, type DefaultValues, type UseFormRegisterReturn, type UseFormReturn } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import type { z } from 'zod';
import {
  caregiverCreateSchema, caregiverUpdateSchema, COMMON_CG_COURSES, EDUCATION_LEVELS, MAX_PROFILE_PHOTO_BASE64, ORGANIZATION_TYPES,
  type CaregiverDetail, type Page as ListPage
} from '@smart-ltc/shared';
import { api, isDemoMode, post } from '../lib/api';
import { compressImage, type PreparedImage } from '../lib/images';
import { Button, Card, ErrorState, Loading, Status } from '../components/ui';
import { AdminPage, fieldClass, labelClass, messageOf } from './adminShared';

export interface Caregiver {
  userId: string; displayName: string; username: string; enabled: boolean; activePatients: number;
  phone?: string; organizationName?: string; education?: string; photoUrl?: string; latestTraining?: string; trainingCount?: number
}

export function useCaregivers() {
  return useQuery({ queryKey: ['admin', 'caregivers'], queryFn: () => api<ListPage<Caregiver>>('/admin/caregivers') });
}

/** Readable but hard to guess: no 0/O or 1/l, so it can be read out to the caregiver. */
function randomPassword(length = 14): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

type CreateForm = z.infer<typeof caregiverCreateSchema>;
type UpdateForm = z.infer<typeof caregiverUpdateSchema>;
/** The fields both forms share, under the same names, so one set of inputs serves both. */
type ProfileForm = Pick<CreateForm, 'displayName' | 'cid' | 'birthDate' | 'phone' | 'address' | 'email' | 'education' | 'organization' | 'trainings'>;

const EMPTY_CAREGIVER: DefaultValues<CreateForm> = {
  displayName: '', username: '', password: '', cid: '', birthDate: '', phone: '', address: '', email: '',
  organization: { name: isDemoMode ? 'รพ.สต. ตัวอย่าง' : (import.meta.env.VITE_FACILITY_NAME || ''), type: 'HEALTH_PROMOTING_HOSPITAL', serviceArea: '' },
  trainings: []
};

const educationName = (value?: string) => EDUCATION_LEVELS.find(([key]) => key === value)?.[1] ?? '';
const hoursIn = (course: string) => { const match = /(\d+) ชั่วโมง/.exec(course); return match ? Number(match[1]) : undefined; };

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="grid gap-4 border-t border-slate-100 pt-5 first:border-0 first:pt-0 md:grid-cols-2">
    <div className="md:col-span-2"><h4 className="text-base font-bold text-slate-900">{title}</h4>{hint && <p className="text-sm text-slate-500">{hint}</p>}</div>
    {children}
  </section>;
}

function FieldError({ message }: { message?: string | undefined }) {
  return message ? <span className="text-xs text-danger">{message}</span> : null;
}

function Avatar({ src, size }: { src?: string | undefined; size: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'h-24 w-24' : 'h-14 w-14';
  return <div className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100`}>
    {src ? <img src={src} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }}/> : <UserRound aria-hidden size={size === 'lg' ? 40 : 24} className="text-slate-400"/>}
  </div>;
}

/** Picks and shrinks a portrait. `currentUrl` is the saved photo, shown until replaced or removed. */
function PhotoPicker({ photo, currentUrl, onPick, onRemove }: { photo: PreparedImage | null; currentUrl?: string | undefined; onPick: (photo: PreparedImage | null) => void; onRemove?: (() => void) | undefined }) {
  const [error, setError] = useState('');
  const choose = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    try {
      // A small portrait is enough for an avatar and keeps the request light.
      const prepared = await compressImage(file, 512, 0.85);
      if (prepared.base64.length > MAX_PROFILE_PHOTO_BASE64) { setError('รูปใหญ่เกินไป กรุณาเลือกรูปอื่น'); return; }
      onPick(prepared);
    } catch (failure) { setError(messageOf(failure)); }
  };
  const shown = photo?.dataUrl ?? currentUrl;
  return <div className="flex items-center gap-4 md:col-span-2">
    <Avatar src={shown} size="lg"/>
    <div>
      <p className={labelClass}>รูปภาพประจำตัว <span className="font-normal text-slate-500">(ไม่บังคับ)</span></p>
      <div className="mt-1 flex flex-wrap gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-primary hover:bg-sky-50"><Camera aria-hidden size={18}/>{shown ? 'เปลี่ยนรูป' : 'ถ่าย/เลือกรูป'}
          <input type="file" accept="image/*" className="sr-only" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ''; }}/></label>
        {photo && <button type="button" onClick={() => onPick(null)} className="min-h-11 rounded-xl px-3 text-sm text-slate-600 hover:bg-slate-100">ยกเลิกรูปที่เลือก</button>}
        {!photo && currentUrl && onRemove && <button type="button" onClick={onRemove} className="min-h-11 rounded-xl px-3 text-sm text-danger hover:bg-red-50">ลบรูป</button>}
      </div>
      <FieldError message={error}/>
    </div>
  </div>;
}

/** Personal details, education, organization and training: the same inputs on the add and edit pages. */
function ProfileFields({ form, photoPicker, cidLabel, cidHint }: { form: UseFormReturn<ProfileForm>; photoPicker: ReactNode; cidLabel: string; cidHint?: string | undefined }) {
  const trainings = useFieldArray({ control: form.control, name: 'trainings' });
  const chosenCourses = (form.watch('trainings') ?? []).map((training) => training.course);
  const errors = form.formState.errors;
  const addTraining = (course = '') => trainings.append({ course, provider: '', completedOn: '', hours: hoursIn(course) });
  return <>
    <Section title="ข้อมูลส่วนตัว">
      {photoPicker}
      <label className={labelClass}>ชื่อ–สกุล<input {...form.register('displayName')} className={fieldClass} autoComplete="off"/><FieldError message={errors.displayName?.message}/></label>
      <label className={labelClass}>{cidLabel}<input {...form.register('cid')} inputMode="numeric" maxLength={13} className={fieldClass} autoComplete="off"/>{cidHint && <span className="block text-xs font-normal text-slate-500">{cidHint}</span>}<FieldError message={errors.cid?.message}/></label>
      <label className={labelClass}>วันเกิด<input type="date" {...form.register('birthDate')} className={fieldClass}/><FieldError message={errors.birthDate?.message}/></label>
      <label className={labelClass}>เบอร์โทร<input type="tel" {...form.register('phone')} inputMode="tel" className={fieldClass} placeholder="08xxxxxxxx"/><FieldError message={errors.phone?.message}/></label>
      <label className={labelClass}>อีเมล <span className="font-normal text-slate-500">(ไม่บังคับ)</span><input type="email" {...form.register('email')} className={fieldClass} autoComplete="off"/><FieldError message={errors.email?.message}/></label>
      <label className={`${labelClass} md:col-span-2`}>ที่อยู่<textarea {...form.register('address')} rows={2} className={fieldClass} placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด"/><FieldError message={errors.address?.message}/></label>
    </Section>

    <Section title="วุฒิการศึกษา">
      <label className={labelClass}>วุฒิการศึกษาสูงสุด<select {...form.register('education')} className={fieldClass}><option value="" disabled>เลือกวุฒิการศึกษา</option>{EDUCATION_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><FieldError message={errors.education?.message}/></label>
    </Section>

    <Section title="ข้อมูลหน่วยงาน" hint="หน่วยงานต้นสังกัดและพื้นที่ที่รับผิดชอบ">
      <label className={labelClass}>ชื่อหน่วยงาน<input {...form.register('organization.name')} className={fieldClass}/><FieldError message={errors.organization?.name?.message}/></label>
      <label className={labelClass}>ประเภทหน่วยงาน<select {...form.register('organization.type')} className={fieldClass}>{ORGANIZATION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><FieldError message={errors.organization?.type?.message}/></label>
      <label className={`${labelClass} md:col-span-2`}>พื้นที่รับผิดชอบ <span className="font-normal text-slate-500">(ไม่บังคับ)</span><input {...form.register('organization.serviceArea')} className={fieldClass} placeholder="เช่น หมู่ 2, 5 ต.ตัวอย่าง"/></label>
    </Section>

    <Section title="ข้อมูลการอบรม" hint="หลักสูตรที่ผ่านการอบรม เพิ่มได้หลายหลักสูตร (สูงสุด 10)">
      <div className="space-y-3 md:col-span-2">
        {trainings.fields.map((field, index) => <div key={field.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[2fr_1.4fr_1fr_0.7fr_auto] md:items-start">
          <label className={labelClass}>หลักสูตร<input {...form.register(`trainings.${index}.course`)} className={fieldClass}/><FieldError message={errors.trainings?.[index]?.course?.message}/></label>
          <label className={labelClass}>หน่วยงานที่จัด<input {...form.register(`trainings.${index}.provider`)} className={fieldClass}/></label>
          <label className={labelClass}>วันที่จบ<input type="date" {...form.register(`trainings.${index}.completedOn`)} className={fieldClass}/><FieldError message={errors.trainings?.[index]?.completedOn?.message}/></label>
          <label className={labelClass}>ชั่วโมง<input type="number" min={1} inputMode="numeric" {...form.register(`trainings.${index}.hours`, { setValueAs: (value: unknown) => (value === '' || value == null ? undefined : Number(value)) })} className={fieldClass}/><FieldError message={errors.trainings?.[index]?.hours?.message}/></label>
          <button type="button" onClick={() => trainings.remove(index)} aria-label={`ลบหลักสูตรที่ ${index + 1}`} className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-slate-500 hover:bg-red-50 hover:text-danger md:mt-6"><Trash2 aria-hidden size={18}/></button>
        </div>)}
        {trainings.fields.length < 10 && <div className="flex flex-wrap gap-2">
          {COMMON_CG_COURSES.filter((course) => !chosenCourses.includes(course)).map((course) => <button key={course} type="button" onClick={() => addTraining(course)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-left text-sm hover:bg-sky-50"><Plus aria-hidden size={14} className="mr-1 inline"/>{course}</button>)}
          <button type="button" onClick={() => addTraining()} className="min-h-10 rounded-lg border border-dashed border-slate-400 px-3 text-sm font-semibold text-primary hover:bg-sky-50"><Plus aria-hidden size={14} className="mr-1 inline"/>หลักสูตรอื่น</button>
        </div>}
      </div>
    </Section>
  </>;
}

function PasswordInput({ field, onRandom, error, label }: { field: UseFormRegisterReturn; onRandom: (password: string) => void; error?: string | undefined; label: ReactNode }) {
  return <label className={labelClass}>{label}
    <div className="flex gap-2"><input {...field} className={fieldClass} autoComplete="new-password"/>
      <button type="button" onClick={() => onRandom(randomPassword())} className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-primary hover:bg-sky-50"><KeyRound aria-hidden size={16}/>สุ่ม</button>
    </div>
    <FieldError message={error}/>
  </label>;
}

const invalidForm = 'ข้อมูลยังไม่ครบหรือไม่ถูกต้อง กรุณาตรวจช่องที่มีข้อความสีแดง';

export function Caregivers() {
  const queryClient = useQueryClient();
  const caregivers = useCaregivers();
  const [created, setCreated] = useState<{ displayName: string; username: string; password: string } | null>(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const form = useForm<CreateForm>({ resolver: zodResolver(caregiverCreateSchema), defaultValues: EMPTY_CAREGIVER });
  const submit = form.handleSubmit(async (values) => {
    setError(''); setCreated(null);
    try {
      await post('/admin/caregivers', { ...values, ...(photo ? { photo: { mimeType: 'image/jpeg', base64: photo.base64 } } : {}) });
      setCreated({ displayName: values.displayName, username: values.username, password: values.password });
      form.reset(EMPTY_CAREGIVER);
      setPhoto(null);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (failure) { setError(messageOf(failure)); }
  }, () => setError(invalidForm));
  const errors = form.formState.errors;

  return <AdminPage title="เพิ่ม CG" description="ลงทะเบียนผู้ดูแลผู้สูงอายุ (Caregiver) พร้อมบัญชีเข้าสู่ระบบ แล้วไปมอบหมายผู้รับบริการในเมนู “มอบหมายงาน CG”">
    {created && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-900">
      <p className="flex items-center gap-2 font-bold"><CheckCircle2 aria-hidden size={18}/>เพิ่ม {created.displayName} แล้ว</p>
      <p className="text-sm">แจ้งข้อมูลนี้แก่ผู้ดูแลโดยตรง ระบบจะไม่แสดงรหัสผ่านอีก</p>
      <p className="mt-1 font-mono">ชื่อผู้ใช้: {created.username} · รหัสผ่าน: {created.password}</p>
    </div>}
    <Card>
      <h3 className="flex items-center gap-2 text-lg font-bold"><UserPlus aria-hidden size={20}/>ฟอร์มผู้ใช้งานผู้ดูแลผู้สูงอายุ (Caregiver)</h3>
      {isDemoMode && <p className="mt-1 text-sm font-semibold text-danger">ระบบ DEMO: ใช้ข้อมูลสมมติเท่านั้น ห้ามกรอกเลขบัตรหรือใช้รูปของบุคคลจริง</p>}
      <form onSubmit={submit} noValidate className="mt-4 space-y-6">
        <ProfileFields form={form as unknown as UseFormReturn<ProfileForm>} cidLabel={isDemoMode ? 'เลขบัตรประชาชน (สมมติ) 13 หลัก' : 'เลขบัตรประชาชน 13 หลัก'}
          photoPicker={<PhotoPicker photo={photo} onPick={setPhoto}/>}/>
        <Section title="บัญชีเข้าสู่ระบบ">
          <label className={labelClass}>ชื่อผู้ใช้<input {...form.register('username')} className={fieldClass} autoComplete="off" autoCapitalize="none" placeholder="เช่น cg.somjai"/><FieldError message={errors.username?.message}/></label>
          <PasswordInput field={form.register('password')} onRandom={(password) => form.setValue('password', password, { shouldValidate: true })} error={errors.password?.message} label="รหัสผ่านเริ่มต้น"/>
        </Section>
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'กำลังบันทึก…' : 'บันทึกผู้ดูแล'}</Button>
          {error && <ErrorState message={error}/>}
        </div>
      </form>
    </Card>

    <h3 className="text-lg font-bold">ผู้ดูแลในระบบ</h3>
    {caregivers.isLoading ? <Loading/> : caregivers.error ? <ErrorState message={caregivers.error.message}/> : caregivers.data?.items.length ? <div className="grid gap-3 md:grid-cols-2">
      {caregivers.data.items.map((caregiver) => <Card key={caregiver.userId}><div className="flex items-start gap-3">
        <Avatar src={caregiver.photoUrl} size="sm"/>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2"><p className="font-bold">{caregiver.displayName}</p><Status tone={caregiver.enabled ? 'success' : 'neutral'}>{caregiver.enabled ? 'ใช้งาน' : 'ปิดใช้งาน'}</Status></div>
          <p className="text-sm text-slate-600">{[caregiver.username || caregiver.userId, caregiver.phone].filter(Boolean).join(' · ')}</p>
          {(caregiver.organizationName || caregiver.education) && <p className="text-sm text-slate-600">{[caregiver.organizationName, educationName(caregiver.education)].filter(Boolean).join(' · ')}</p>}
          <p className="mt-1 text-sm">ดูแล {caregiver.activePatients} ราย{caregiver.trainingCount ? ` · อบรม ${caregiver.trainingCount} หลักสูตร (ล่าสุด: ${caregiver.latestTraining})` : ' · ยังไม่มีข้อมูลการอบรม'}</p>
          <Link to={`/settings/caregivers/${encodeURIComponent(caregiver.userId)}`} className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-primary hover:bg-sky-50"><Pencil aria-hidden size={15}/>แก้ไขข้อมูล</Link>
        </div>
      </div></Card>)}
    </div> : <Card><p className="text-center text-slate-500">ยังไม่มี CG</p></Card>}
  </AdminPage>;
}

const toFormValues = (detail: CaregiverDetail): DefaultValues<UpdateForm> => ({
  userId: detail.userId, recordVersion: detail.recordVersion, enabled: detail.enabled, displayName: detail.displayName,
  cid: '', birthDate: detail.birthDate, phone: detail.phone, address: detail.address, email: detail.email,
  education: (detail.education || '') as UpdateForm['education'],
  organization: { name: detail.organization.name, type: detail.organization.type as UpdateForm['organization']['type'], serviceArea: detail.organization.serviceArea },
  trainings: detail.trainings, newPassword: '', removePhoto: false
});

export function CaregiverEdit() {
  const { userId = '' } = useParams();
  const detail = useQuery({ queryKey: ['admin', 'caregiver', userId], queryFn: () => post<CaregiverDetail>('/admin/caregivers/get', { userId }) });
  // Kept here: saving reloads the caregiver, which remounts the form with the new record version.
  const [saved, setSaved] = useState('');
  return <AdminPage title="แก้ไขข้อมูล CG" description="แก้ไขข้อมูลส่วนตัว วุฒิการศึกษา หน่วยงาน และการอบรม เปิด/ปิดการใช้งาน หรือตั้งรหัสผ่านใหม่">
    <Link to="/settings/caregivers" className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft aria-hidden size={16}/>กลับไปหน้ารายชื่อ CG</Link>
    {detail.isLoading ? <Loading/> : detail.error ? <ErrorState message={detail.error.message}/> : <>
      {saved && <p role="status" className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-green-900"><CheckCircle2 aria-hidden size={18} className="mt-0.5 shrink-0"/>{saved}</p>}
      <EditForm key={`${detail.data!.userId}:${detail.data!.recordVersion}`} detail={detail.data!} onSaved={setSaved}/>
    </>}
  </AdminPage>;
}

function EditForm({ detail, onSaved }: { detail: CaregiverDetail; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [error, setError] = useState('');
  const form = useForm<UpdateForm>({ resolver: zodResolver(caregiverUpdateSchema), defaultValues: toFormValues(detail) });
  const enabled = form.watch('enabled');
  const removePhoto = form.watch('removePhoto');
  const submit = form.handleSubmit(async (values) => {
    setError(''); onSaved('');
    try {
      await post('/admin/caregivers/update', { ...values, ...(photo ? { photo: { mimeType: 'image/jpeg', base64: photo.base64 }, removePhoto: false } : {}) });
      onSaved(values.newPassword ? `บันทึกแล้ว · รหัสผ่านใหม่: ${values.newPassword} (แจ้งผู้ดูแลโดยตรง ระบบจะไม่แสดงอีก)` : 'บันทึกการแก้ไขแล้ว');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Reload so the form carries the new record version for the next edit.
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (failure) { setError(messageOf(failure)); }
  }, () => setError(invalidForm));
  const errors = form.formState.errors;

  return <>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-lg font-bold">{detail.displayName}</p><p className="text-sm text-slate-600">ชื่อผู้ใช้: {detail.username || '–'} · ดูแล {detail.activePatients} ราย</p></div>
        <Status tone={detail.enabled ? 'success' : 'neutral'}>{detail.enabled ? 'ใช้งาน' : 'ปิดใช้งาน'}</Status>
      </div>
      {detail.recordVersion === 0 && <p role="note" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">ผู้ดูแลรายนี้ลงทะเบียนก่อนมีฟอร์มโปรไฟล์ กรุณากรอกข้อมูลให้ครบแล้วบันทึก</p>}
      <form onSubmit={submit} noValidate className="mt-4 space-y-6">
        <ProfileFields form={form as unknown as UseFormReturn<ProfileForm>}
          cidLabel="เลขบัตรประชาชนใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
          cidHint={detail.cidLast4 ? `ที่บันทึกไว้ลงท้ายด้วย ${detail.cidLast4}` : 'ยังไม่ได้บันทึกเลขบัตรประชาชน'}
          photoPicker={<PhotoPicker photo={photo} currentUrl={removePhoto ? undefined : detail.photoUrl || undefined}
            onPick={(next) => { setPhoto(next); if (next) form.setValue('removePhoto', false); }}
            onRemove={() => form.setValue('removePhoto', true, { shouldDirty: true })}/>}/>

        <Section title="บัญชีและการเข้าใช้งาน">
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-300 px-3 md:col-span-2">
            <input type="checkbox" {...form.register('enabled')} className="h-5 w-5"/>
            <span><span className="font-semibold">เปิดใช้งานบัญชี</span><span className="block text-sm text-slate-500">ปิดเมื่อผู้ดูแลลาออกหรือพักงาน บัญชีที่ปิดจะเข้าสู่ระบบไม่ได้</span></span>
          </label>
          {!enabled && detail.activePatients > 0 && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">ผู้ดูแลรายนี้ยังดูแลผู้รับบริการ {detail.activePatients} ราย หลังปิดบัญชีให้ไปที่ <Link to="/assignments" className="font-semibold underline">มอบหมายงาน CG</Link> เพื่อมอบหมายให้ผู้ดูแลคนอื่น</p>}
          <PasswordInput field={form.register('newPassword')} onRandom={(password) => form.setValue('newPassword', password, { shouldValidate: true, shouldDirty: true })} error={errors.newPassword?.message} label={<>ตั้งรหัสผ่านใหม่ <span className="font-normal text-slate-500">(เว้นว่างถ้าไม่เปลี่ยน)</span></>}/>
        </Section>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</Button>
          <Link to="/settings/caregivers" className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-slate-600 hover:bg-slate-100">ยกเลิก</Link>
        </div>
        {error && <ErrorState message={error}/>}
      </form>
    </Card>
  </>;
}
