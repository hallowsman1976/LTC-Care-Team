import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { type Page, adlAssessmentItemsSchema, calculateAdlTotal, ltcObservationSchema, patientCreateSchema, suggestLtcGroup } from '@smart-ltc/shared';
import { api, isDemoMode, post, todayInBangkok } from '../lib/api';
import { Button, Card, ErrorState, Status } from '../components/ui';

const fieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2';
const labelClass = 'block text-sm font-semibold text-slate-700';

type Outcome = { tone: 'success' | 'error'; text: string } | null;

function OutcomeMessage({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return outcome.tone === 'success' ? <p role="status" className="mt-3 text-success">{outcome.text}</p> : <div className="mt-3"><ErrorState message={outcome.text}/></div>;
}

/** Runs a submit and reports success or the server's message. */
async function attempt(setOutcome: (outcome: Outcome) => void, work: () => Promise<unknown>, success: string): Promise<void> {
  setOutcome(null);
  try { await work(); setOutcome({ tone: 'success', text: success }); }
  catch (error) { setOutcome({ tone: 'error', text: error instanceof Error ? error.message : 'ส่งไม่สำเร็จ' }); }
}

/** Empty number inputs mean "not measured", not zero. */
const optionalNumber = (schema: z.ZodNumber) => z.preprocess((value) => (value === '' || value == null || (typeof value === 'number' && Number.isNaN(value)) ? undefined : Number(value)), schema.optional());

function FormPage({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl space-y-5"><div><h2 className="text-2xl font-bold">{title}</h2><p className="text-slate-600">{description}</p></div><Card>{children}</Card></div>;
}

export function PatientForm() {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const form = useForm<z.infer<typeof patientCreateSchema>>({
    resolver: zodResolver(patientCreateSchema),
    defaultValues: { localCode: '', hn: '', cid: '', fullName: '', birthDate: '', sex: 'UNKNOWN', address: '', village: '', phone: '', legalBasis: undefined, privacyNoticeVersion: import.meta.env.VITE_PRIVACY_NOTICE_VERSION || '' }
  });
  const submit = form.handleSubmit((values) => attempt(setOutcome, () => post('/patients', values), isDemoMode ? 'บันทึกข้อมูลจำลองแล้ว' : 'บันทึกผู้รับบริการและฐานการประมวลผลแล้ว'));
  return <FormPage title="เพิ่มผู้รับบริการ" description={isDemoMode ? 'ห้ามกรอกข้อมูลบุคคลจริงในระบบ DEMO' : 'กรอกเฉพาะข้อมูลที่จำเป็นตามฐานการประมวลผลที่หน่วยบริการอนุมัติ'}>
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      {([['localCode', 'รหัสท้องถิ่น'], ['hn', 'HN'], ['cid', isDemoMode ? 'CID จำลอง 13 หลัก' : 'เลขประจำตัวประชาชน 13 หลัก'], ['fullName', isDemoMode ? 'ชื่อ–สกุลจำลอง' : 'ชื่อ–สกุล'], ['birthDate', 'วันเกิด']] as const).map(([name, label]) => <label className={labelClass} key={name}>{label}<input type={name === 'birthDate' ? 'date' : 'text'} {...form.register(name)} className={fieldClass}/><span className="text-xs text-danger">{form.formState.errors[name]?.message}</span></label>)}
      <label className={labelClass}>เพศ<select {...form.register('sex')} className={fieldClass}><option value="UNKNOWN">ไม่ระบุ</option><option value="FEMALE">หญิง</option><option value="MALE">ชาย</option><option value="OTHER">อื่น ๆ</option></select></label>
      <label className={`${labelClass} md:col-span-2`}>{isDemoMode ? 'ที่อยู่จำลอง' : 'ที่อยู่สำหรับให้บริการ'}<textarea {...form.register('address')} className={fieldClass}/><span className="text-xs text-danger">{form.formState.errors.address?.message}</span></label>
      <label className={labelClass}>หมู่บ้าน<input {...form.register('village')} className={fieldClass}/></label>
      <label className={labelClass}>{isDemoMode ? 'โทรศัพท์จำลอง' : 'โทรศัพท์'}<input {...form.register('phone')} className={fieldClass}/></label>
      {!isDemoMode && <><label className={labelClass}>ฐานการประมวลผล<select {...form.register('legalBasis')} className={fieldClass}><option value="">กรุณาเลือก</option><option value="PUBLIC_HEALTH">ภารกิจด้านสาธารณสุข</option><option value="MEDICAL_CARE">การให้บริการด้านสุขภาพ</option><option value="LEGAL_OBLIGATION">หน้าที่ตามกฎหมาย</option><option value="EXPLICIT_CONSENT">ความยินยอมโดยชัดแจ้ง</option></select></label><label className={labelClass}>เวอร์ชันประกาศความเป็นส่วนตัว<input {...form.register('privacyNoticeVersion')} readOnly className={fieldClass}/></label></>}
      <div className="md:col-span-2"><Button type="submit" disabled={form.formState.isSubmitting}>บันทึกผู้รับบริการ</Button><OutcomeMessage outcome={outcome}/></div>
    </form>
  </FormPage>;
}

type AdlKey = keyof z.infer<typeof adlAssessmentItemsSchema>;

/** Barthel ADL: what each score means, so assessors score observed ability the same way. */
export const ADL_ITEMS: Array<{ key: AdlKey; title: string; hint?: string; levels: string[] }> = [
  { key: 'feeding', title: '1. การรับประทานอาหาร', hint: 'เมื่อเตรียมสำรับไว้ให้เรียบร้อยต่อหน้า', levels: [
    'ตักอาหารเข้าปากเองไม่ได้ ต้องมีคนป้อนให้',
    'ตักอาหารเองได้แต่ต้องมีคนช่วย เช่น ช่วยตักเตรียมไว้หรือตัดเป็นชิ้นเล็กให้ก่อน',
    'ตักอาหารและช่วยตัวเองได้เป็นปกติ'] },
  { key: 'grooming', title: '2. การล้างหน้า หวีผม แปรงฟัน โกนหนวด', hint: 'ในช่วง 24–48 ชั่วโมงที่ผ่านมา', levels: [
    'ต้องมีคนช่วย',
    'ทำได้เอง (รวมถึงกรณีที่มีคนเตรียมอุปกรณ์ไว้ให้)'] },
  { key: 'transfer', title: '3. การลุกนั่งจากที่นอน หรือจากเตียงไปเก้าอี้', levels: [
    'นั่งไม่ได้ (นั่งแล้วล้ม) หรือต้องใช้คน 2 คนช่วยยกขึ้น',
    'ต้องช่วยมากจึงนั่งได้ เช่น ใช้คนที่มีทักษะ 1 คน หรือคนทั่วไป 2 คนพยุงหรือดันขึ้น',
    'ต้องช่วยบ้าง เช่น บอกให้ทำตาม ช่วยพยุงเล็กน้อย หรือคอยดูแลเพื่อความปลอดภัย',
    'ทำได้เอง'] },
  { key: 'toiletUse', title: '4. การใช้ห้องน้ำ', levels: [
    'ช่วยตัวเองไม่ได้',
    'ทำเองได้บ้าง (อย่างน้อยทำความสะอาดตัวเองหลังเสร็จธุระได้) แต่ต้องช่วยในบางขั้นตอน',
    'ช่วยตัวเองได้ดี ขึ้นลงโถส้วม ทำความสะอาด และจัดเสื้อผ้าได้เอง'] },
  { key: 'mobility', title: '5. การเคลื่อนที่ภายในห้องหรือบ้าน', levels: [
    'เคลื่อนที่ไปไหนไม่ได้',
    'ใช้รถเข็นเคลื่อนที่ได้เองโดยไม่ต้องมีคนเข็น และเข้าออกมุมห้องหรือประตูได้',
    'เดินหรือเคลื่อนที่โดยมีคนช่วย เช่น พยุง บอกให้ทำตาม หรือคอยดูแลเพื่อความปลอดภัย',
    'เดินหรือเคลื่อนที่ได้เอง'] },
  { key: 'dressing', title: '6. การสวมใส่เสื้อผ้า', levels: [
    'ต้องมีคนสวมใส่ให้ ช่วยตัวเองแทบไม่ได้',
    'ช่วยตัวเองได้ประมาณครึ่งหนึ่ง ที่เหลือต้องมีคนช่วย',
    'ช่วยตัวเองได้ดี รวมทั้งติดกระดุม รูดซิป หรือใช้เสื้อผ้าที่ดัดแปลงให้เหมาะสม'] },
  { key: 'stairs', title: '7. การขึ้นลงบันได 1 ชั้น', levels: [
    'ทำไม่ได้',
    'ต้องมีคนช่วย',
    'ขึ้นลงได้เอง (ถ้าใช้เครื่องช่วยเดิน ต้องนำขึ้นลงได้เองด้วย)'] },
  { key: 'bathing', title: '8. การอาบน้ำ', levels: [
    'ต้องมีคนช่วยหรือทำให้',
    'อาบน้ำได้เอง'] },
  { key: 'bowels', title: '9. การกลั้นอุจจาระ', hint: 'ในช่วง 1 สัปดาห์ที่ผ่านมา', levels: [
    'กลั้นไม่ได้ หรือต้องสวนอุจจาระเป็นประจำ',
    'กลั้นไม่ได้บางครั้ง (น้อยกว่าสัปดาห์ละ 1 ครั้ง)',
    'กลั้นได้ปกติ'] },
  { key: 'bladder', title: '10. การกลั้นปัสสาวะ', hint: 'ในช่วง 1 สัปดาห์ที่ผ่านมา', levels: [
    'กลั้นไม่ได้ หรือใส่สายสวนปัสสาวะแต่ดูแลเองไม่ได้',
    'กลั้นไม่ได้บางครั้ง (น้อยกว่าวันละ 1 ครั้ง)',
    'กลั้นได้ปกติ'] }
];

interface PatientName { patientId: string; fullName: string; localCode?: string; hn?: string }

/** Names the patient on clinical forms, so a CM never scores the wrong person by id alone. */
function PatientBanner({ patientId }: { patientId: string }) {
  const query = useQuery({ queryKey: ['patients', 'names'], queryFn: () => api<Page<PatientName>>('/patients') });
  const patient = query.data?.items.find((item) => item.patientId === patientId);
  return <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3">
    <p className="text-sm text-slate-600">ผู้รับบริการ</p>
    <p className="text-lg font-bold">{patient ? patient.fullName : query.isLoading ? 'กำลังโหลด…' : 'ไม่พบชื่อในรายการ'}</p>
    <p className="text-sm text-slate-600">{[patient?.localCode, patient?.hn ? `HN ${patient.hn}` : '', patientId].filter(Boolean).join(' · ')}</p>
  </div>;
}

export function AdlForm() {
  const { id: patientId = '' } = useParams();
  const [outcome, setOutcome] = useState<Outcome>(null);
  // No defaults: an unanswered item must stay visibly unanswered rather than score 0.
  const form = useForm<z.infer<typeof adlAssessmentItemsSchema>>({ resolver: zodResolver(adlAssessmentItemsSchema) });
  const values = form.watch();
  const answered = ADL_ITEMS.filter(({ key }) => typeof values[key] === 'number').length;
  const total = adlAssessmentItemsSchema.safeParse(values).success ? calculateAdlTotal(values) : null;
  const errors = form.formState.errors;
  return <FormPage title="ประเมิน Barthel ADL" description="เลือกระดับที่ผู้รับบริการทำได้จริงในปัจจุบัน ระบบจะคำนวณคะแนนใหม่ฝั่ง server">
    <PatientBanner patientId={patientId}/>
    <form onSubmit={form.handleSubmit((items) => attempt(setOutcome, () => post('/adl-assessments', { patientId, assessmentDate: todayInBangkok(), items }), 'ส่งแบบประเมินแล้ว'))} className="space-y-4">
      {ADL_ITEMS.map(({ key, title, hint, levels }) => <fieldset key={key} className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 font-bold">{title}{hint && <span className="ml-2 text-sm font-normal text-slate-500">({hint})</span>}</legend>
        <div className="mt-1 space-y-2">{levels.map((text, score) => <label key={score} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-2 ${values[key] === score ? 'border-primary bg-sky-50' : 'border-slate-200'}`}>
          <input type="radio" name={key} checked={values[key] === score} onChange={() => form.setValue(key, score as never, { shouldValidate: true })} className="mt-1 h-5 w-5"/>
          <span className="flex-1">{text}</span><span className="whitespace-nowrap font-bold text-primary">{score} คะแนน</span>
        </label>)}</div>
        {errors[key] && <p className="mt-1 text-xs text-danger">กรุณาเลือกระดับของข้อนี้</p>}
      </fieldset>)}
      <div className="sticky bottom-20 flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 shadow-sm md:bottom-4"><span className="font-bold">คะแนนรวม <span className="text-sm font-normal text-slate-600">(ตอบแล้ว {answered}/{ADL_ITEMS.length} ข้อ)</span></span><span aria-live="polite" className="text-2xl font-bold text-primary">{total ?? '–'}/20</span></div>
      <Button type="submit" disabled={form.formState.isSubmitting}>อนุมัติแบบประเมิน</Button><OutcomeMessage outcome={outcome}/>
    </form>
  </FormPage>;
}

const classificationSchema = ltcObservationSchema.extend({
  groupNumber: z.coerce.number().int().min(1).max(4), rationale: z.string().trim().min(10, 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร')
});

export function ClassificationForm() {
  const { id: patientId = '' } = useParams();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const form = useForm<z.infer<typeof classificationSchema>>({ resolver: zodResolver(classificationSchema), defaultValues: { mobilityStatus: 'UNKNOWN', cognitiveStatus: 'UNKNOWN', terminalStatus: 'UNKNOWN', groupNumber: 1, rationale: '' } });
  const { mobilityStatus, cognitiveStatus, terminalStatus } = form.watch();
  // Preview only: the suggestion rules do not depend on the ADL score. The server re-runs them
  // against the latest approved ADL assessment when the CM confirms.
  const suggestion = suggestLtcGroup({ adlTotal: 0, mobilityStatus, cognitiveStatus, terminalStatus });
  return <FormPage title="ยืนยันกลุ่ม LTC" description="คำแนะนำไม่ใช่การยืนยัน CM ต้องเลือกและระบุเหตุผลเสมอ ระบบใช้คะแนน ADL ที่อนุมัติล่าสุดของผู้รับบริการ">
    <PatientBanner patientId={patientId}/>
    <form onSubmit={form.handleSubmit(({ groupNumber, rationale, ...observation }) => attempt(setOutcome, () => post('/ltc-classifications', { patientId, observation, groupNumber, rationale }), 'ยืนยันกลุ่มแล้ว'))} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className={labelClass}>การเคลื่อนไหว<select {...form.register('mobilityStatus')} className={fieldClass}><option value="UNKNOWN">ยังไม่ทราบ</option><option value="INDEPENDENT">อิสระ</option><option value="ASSISTED">ต้องช่วย</option><option value="DEPENDENT">ไม่สามารถเอง</option></select></label>
        <label className={labelClass}>การรับรู้<select {...form.register('cognitiveStatus')} className={fieldClass}><option value="UNKNOWN">ยังไม่ทราบ</option><option value="NO_SIGNIFICANT_DISTURBANCE">ไม่พบความผิดปกติสำคัญ</option><option value="DISTURBANCE">พบความผิดปกติ</option></select></label>
        <label className={labelClass}>ระยะสุดท้าย<select {...form.register('terminalStatus')} className={fieldClass}><option value="UNKNOWN">ยังไม่ทราบ</option><option value="NOT_CONFIRMED">ไม่ยืนยัน</option><option value="CONFIRMED">ยืนยันแล้ว</option></select></label>
      </div>
      <div className="rounded-xl bg-amber-50 p-4">คำแนะนำ: {suggestion.groupNumber ? <Status tone="warning">กลุ่ม {suggestion.groupNumber}</Status> : <Status tone="danger">ต้องให้ CM ทบทวน</Status>}</div>
      <label className={labelClass}>กลุ่มที่ CM ยืนยัน<select {...form.register('groupNumber')} className={fieldClass}>{[1, 2, 3, 4].map((group) => <option value={group} key={group}>กลุ่ม {group}</option>)}</select></label>
      <label className={labelClass}>เหตุผล<textarea {...form.register('rationale')} className={fieldClass}/><span className="text-xs text-danger">{form.formState.errors.rationale?.message}</span></label>
      <Button type="submit" disabled={form.formState.isSubmitting}>ยืนยันกลุ่ม</Button><OutcomeMessage outcome={outcome}/>
    </form>
  </FormPage>;
}

const weekdayLabels = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const timeOfDay = z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบเวลา HH:MM');
export const carePlanSchema = z.object({
  patientId: z.string().trim().min(1, 'กรุณาระบุรหัสผู้รับบริการ'), rulesetId: z.string().trim().min(1, 'กรุณาระบุชุดกฎบริการ'),
  effectiveFrom: z.string().date('กรุณาเลือกวันที่'), effectiveTo: z.string().date('กรุณาเลือกวันที่'), goalsSummary: z.string().trim().min(10, 'อย่างน้อย 10 ตัวอักษร'),
  serviceType: z.string().trim().min(2, 'กรุณาระบุประเภทบริการ'), instructions: z.string().trim().min(10, 'อย่างน้อย 10 ตัวอักษร'),
  unit: z.enum(['WEEK', 'MONTH']),
  // Checkbox groups yield false (none), a string (one) or a string[] (several).
  weekdays: z.preprocess((value) => (Array.isArray(value) ? value : value ? [value] : []), z.array(z.coerce.number().int().min(1).max(7))),
  dayOfMonth: optionalNumber(z.number().int().min(1).max(28)), windowStart: timeOfDay, windowEnd: timeOfDay
}).superRefine((plan, context) => {
  if (plan.unit === 'WEEK' && plan.weekdays.length === 0) context.addIssue({ code: 'custom', path: ['weekdays'], message: 'เลือกอย่างน้อยหนึ่งวัน' });
  if (plan.unit === 'MONTH' && plan.dayOfMonth === undefined) context.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'ระบุวันที่ 1–28' });
  if (plan.windowEnd <= plan.windowStart) context.addIssue({ code: 'custom', path: ['windowEnd'], message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' });
  if (plan.effectiveTo < plan.effectiveFrom) context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' });
});
type CarePlanValues = z.infer<typeof carePlanSchema>;

export function toCarePlanRequest(values: CarePlanValues) {
  const window = { windowStart: values.windowStart, windowEnd: values.windowEnd };
  const weekdays = [...new Set(values.weekdays)].sort((left, right) => left - right);
  const schedulePattern = values.unit === 'WEEK'
    ? { unit: 'WEEK', count: weekdays.length, weekdays, ...window }
    : { unit: 'MONTH', count: 1, mode: 'DAY_OF_MONTH', dayOfMonth: values.dayOfMonth, ...window };
  return {
    patientId: values.patientId, rulesetId: values.rulesetId, effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo, goalsSummary: values.goalsSummary,
    intervention: { serviceType: values.serviceType, instructions: values.instructions, schedulePattern }
  };
}

/** The sample ruleset added by the GAS seedDemoData function; PILOT has no default. */
const DEMO_RULESET_ID = 'rs-demo-2569';

interface DraftPlan { carePlanId: string; recordVersion: number }

/** Approving a draft is a separate, deliberate step: GAS checks the activation conditions. */
function ActivatePlan({ plan }: { plan: DraftPlan }) {
  const [rationale, setRationale] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const activate = async () => {
    setBusy(true);
    await attempt(setOutcome, () => post('/care-plans/activate', { carePlanId: plan.carePlanId, recordVersion: Number(plan.recordVersion), approvalRationale: rationale.trim() }), 'อนุมัติแผนแล้ว ตารางเยี่ยมจะถูกสร้างเมื่อรันตัวจัดตาราง');
    setBusy(false);
  };
  return <div className="mt-4 space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4 md:col-span-2">
    <p className="font-bold">ร่างแผนพร้อมอนุมัติ</p>
    <p className="text-sm text-slate-600">ต้องมีผลจัดกลุ่มที่ยืนยันแล้วและผู้ดูแลที่ได้รับมอบหมาย หากอนุมัติแผนที่ตนเองสร้าง ต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษร</p>
    <label className={labelClass}>เหตุผลการอนุมัติ<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} className={fieldClass}/></label>
    <Button type="button" disabled={busy || outcome?.tone === 'success'} onClick={activate}>อนุมัติแผน</Button><OutcomeMessage outcome={outcome}/>
  </div>;
}

export function CarePlanForm() {
  const [searchParams] = useSearchParams();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [draft, setDraft] = useState<DraftPlan | null>(null);
  const form = useForm<CarePlanValues>({ resolver: zodResolver(carePlanSchema), defaultValues: { patientId: searchParams.get('patientId') ?? '', rulesetId: isDemoMode ? DEMO_RULESET_ID : '', effectiveFrom: '', effectiveTo: '', goalsSummary: '', serviceType: '', instructions: '', unit: 'WEEK', weekdays: [], windowStart: '09:00', windowEnd: '12:00' } });
  const unit = form.watch('unit');
  const errors = form.formState.errors;
  return <FormPage title="สร้าง Care Plan" description="แผนเริ่มเป็น DRAFT และยังไม่สร้างตารางจนผ่านเงื่อนไข activation">
    <form onSubmit={form.handleSubmit((values) => attempt(setOutcome, async () => setDraft(await post<DraftPlan>('/care-plans', toCarePlanRequest(values))), 'สร้างร่างแผนแล้ว'))} className="grid gap-4 md:grid-cols-2">
      {([['patientId', 'รหัสผู้รับบริการ'], ['rulesetId', 'ชุดกฎบริการที่อนุมัติแล้ว'], ['effectiveFrom', 'เริ่มวันที่'], ['effectiveTo', 'ถึงวันที่'], ['serviceType', 'ประเภทบริการ']] as const).map(([name, label]) => <label key={name} className={labelClass}>{label}<input type={name.startsWith('effective') ? 'date' : 'text'} {...form.register(name)} className={fieldClass}/><span className="text-xs text-danger">{errors[name]?.message}</span></label>)}
      <label className={labelClass}>รอบการเยี่ยม<select {...form.register('unit')} className={fieldClass}><option value="WEEK">รายสัปดาห์</option><option value="MONTH">รายเดือน</option></select></label>
      {unit === 'WEEK'
        ? <fieldset className="md:col-span-2"><legend className={labelClass}>วันที่เยี่ยมในแต่ละสัปดาห์</legend><div className="mt-2 flex flex-wrap gap-3">{weekdayLabels.map((label, index) => <label key={label} className="flex min-h-12 items-center gap-2"><input type="checkbox" value={index + 1} {...form.register('weekdays')} className="h-5 w-5"/>{label}</label>)}</div><span className="text-xs text-danger">{errors.weekdays?.message}</span></fieldset>
        : <label className={labelClass}>วันที่ของเดือน (1–28)<input type="number" {...form.register('dayOfMonth')} className={fieldClass}/><span className="text-xs text-danger">{errors.dayOfMonth?.message}</span></label>}
      <label className={labelClass}>เวลาเริ่ม<input type="time" {...form.register('windowStart')} className={fieldClass}/></label>
      <label className={labelClass}>เวลาสิ้นสุด<input type="time" {...form.register('windowEnd')} className={fieldClass}/><span className="text-xs text-danger">{errors.windowEnd?.message}</span></label>
      <label className={`${labelClass} md:col-span-2`}>เป้าหมาย<textarea {...form.register('goalsSummary')} className={fieldClass}/><span className="text-xs text-danger">{errors.goalsSummary?.message}</span></label>
      <label className={`${labelClass} md:col-span-2`}>คำแนะนำกิจกรรม<textarea {...form.register('instructions')} className={fieldClass}/><span className="text-xs text-danger">{errors.instructions?.message}</span></label>
      <div className="md:col-span-2"><Button type="submit" disabled={form.formState.isSubmitting || draft !== null}>บันทึกร่าง</Button><OutcomeMessage outcome={outcome}/></div>
      {draft && <ActivatePlan plan={draft}/>}
    </form>
  </FormPage>;
}

const visitSchema = z.object({
  startedAt: z.string().min(1, 'กรุณาระบุเวลาเริ่ม'), endedAt: z.string().min(1, 'กรุณาระบุเวลาเสร็จ'), activityCompleted: z.boolean(), notes: z.string().max(2000),
  temperature: optionalNumber(z.number().min(30).max(45)), pulse: optionalNumber(z.number().int().min(20).max(250)), urgentFlag: z.boolean()
});
type VisitValues = z.infer<typeof visitSchema>;

export function VisitForm() {
  const { id: visitId = '' } = useParams();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const form = useForm<VisitValues>({ resolver: zodResolver(visitSchema), defaultValues: { startedAt: '', endedAt: '', activityCompleted: false, notes: '', urgentFlag: false } });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(({ temperature, pulse, ...values }) => attempt(setOutcome, () => post('/visit-encounters', {
    visitId, submissionId: crypto.randomUUID(), source: 'ONLINE', ...values,
    vitals: { ...(temperature === undefined ? {} : { temperature }), ...(pulse === undefined ? {} : { pulse }) }
  }), 'ส่งงานแล้วและได้รับ receipt'));
  return <FormPage title="บันทึกการเยี่ยม" description="ข้อมูลที่ส่งแล้วแก้ไม่ได้จนกว่า CM จะคืนรายการ">
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>เริ่มจริง<input type="datetime-local" {...form.register('startedAt')} className={fieldClass}/><span className="text-xs text-danger">{errors.startedAt?.message}</span></label>
        <label className={labelClass}>เสร็จจริง<input type="datetime-local" {...form.register('endedAt')} className={fieldClass}/><span className="text-xs text-danger">{errors.endedAt?.message}</span></label>
        <label className={labelClass}>อุณหภูมิ (°C)<input type="number" step="0.1" {...form.register('temperature')} className={fieldClass}/><span className="text-xs text-danger">{errors.temperature?.message}</span></label>
        <label className={labelClass}>ชีพจร (bpm)<input type="number" {...form.register('pulse')} className={fieldClass}/><span className="text-xs text-danger">{errors.pulse?.message}</span></label>
      </div>
      <label className="flex min-h-12 items-center gap-3"><input type="checkbox" {...form.register('activityCompleted')} className="h-5 w-5"/>ทำกิจกรรมตามแผนครบ</label>
      <label className="flex min-h-12 items-center gap-3"><input type="checkbox" {...form.register('urgentFlag')} className="h-5 w-5"/>พบประเด็นเร่งด่วน — ระบบจะแจ้งเตือน CM</label>
      <label className={labelClass}>บันทึก<textarea {...form.register('notes')} className={fieldClass}/></label>
      <Button type="submit" disabled={form.formState.isSubmitting}>ตรวจทานและส่ง</Button><OutcomeMessage outcome={outcome}/>
    </form>
  </FormPage>;
}
