import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { adlAssessmentItemsSchema, calculateAdlTotal, ltcObservationSchema, patientCreateSchema, suggestLtcGroup } from '@smart-ltc/shared';
import { isDemoMode, post, todayInBangkok } from '../lib/api';
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

const adlLabels: Array<[keyof z.infer<typeof adlAssessmentItemsSchema>, string, number[]]> = [
  ['feeding', 'รับประทานอาหาร', [0, 1, 2]], ['grooming', 'ล้างหน้า/หวีผม', [0, 1]],
  ['transfer', 'ลุกจากเตียงไปเก้าอี้', [0, 1, 2, 3]], ['toiletUse', 'ใช้ห้องน้ำ', [0, 1, 2]],
  ['mobility', 'การเคลื่อนที่', [0, 1, 2, 3]], ['dressing', 'การแต่งตัว', [0, 1, 2]],
  ['stairs', 'ขึ้นลงบันได', [0, 1, 2]], ['bathing', 'อาบน้ำ', [0, 1]],
  ['bowels', 'การควบคุมอุจจาระ', [0, 1, 2]], ['bladder', 'การควบคุมปัสสาวะ', [0, 1, 2]]
];

export function AdlForm() {
  const { id: patientId = '' } = useParams();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const form = useForm<z.infer<typeof adlAssessmentItemsSchema>>({ resolver: zodResolver(adlAssessmentItemsSchema), defaultValues: Object.fromEntries(adlLabels.map(([key]) => [key, 0])) as z.infer<typeof adlAssessmentItemsSchema> });
  const values = form.watch();
  const total = adlAssessmentItemsSchema.safeParse(values).success ? calculateAdlTotal(values) : 0;
  return <FormPage title="ประเมิน Barthel ADL" description="ประเมินสิ่งที่ทำได้จริงและระบบจะคำนวณคะแนนใหม่ฝั่ง server">
    <form onSubmit={form.handleSubmit((items) => attempt(setOutcome, () => post('/adl-assessments', { patientId, assessmentDate: todayInBangkok(), items }), 'ส่งแบบประเมินแล้ว'))} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">{adlLabels.map(([name, label, options]) => <label key={name} className={labelClass}>{label}<select {...form.register(name, { valueAsNumber: true })} className={fieldClass}>{options.map((score) => <option key={score} value={score}>{score} คะแนน</option>)}</select></label>)}</div>
      <div className="flex items-center justify-between rounded-xl bg-sky-50 p-4"><span className="font-bold">คะแนนรวม</span><span aria-live="polite" className="text-2xl font-bold text-primary">{total}/20</span></div>
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

export function CarePlanForm() {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const form = useForm<CarePlanValues>({ resolver: zodResolver(carePlanSchema), defaultValues: { patientId: '', rulesetId: '', effectiveFrom: '', effectiveTo: '', goalsSummary: '', serviceType: '', instructions: '', unit: 'WEEK', weekdays: [], windowStart: '09:00', windowEnd: '12:00' } });
  const unit = form.watch('unit');
  const errors = form.formState.errors;
  return <FormPage title="สร้าง Care Plan" description="แผนเริ่มเป็น DRAFT และยังไม่สร้างตารางจนผ่านเงื่อนไข activation">
    <form onSubmit={form.handleSubmit((values) => attempt(setOutcome, () => post('/care-plans', toCarePlanRequest(values)), 'สร้างร่างแผนแล้ว'))} className="grid gap-4 md:grid-cols-2">
      {([['patientId', 'รหัสผู้รับบริการ'], ['rulesetId', 'ชุดกฎบริการที่อนุมัติแล้ว'], ['effectiveFrom', 'เริ่มวันที่'], ['effectiveTo', 'ถึงวันที่'], ['serviceType', 'ประเภทบริการ']] as const).map(([name, label]) => <label key={name} className={labelClass}>{label}<input type={name.startsWith('effective') ? 'date' : 'text'} {...form.register(name)} className={fieldClass}/><span className="text-xs text-danger">{errors[name]?.message}</span></label>)}
      <label className={labelClass}>รอบการเยี่ยม<select {...form.register('unit')} className={fieldClass}><option value="WEEK">รายสัปดาห์</option><option value="MONTH">รายเดือน</option></select></label>
      {unit === 'WEEK'
        ? <fieldset className="md:col-span-2"><legend className={labelClass}>วันที่เยี่ยมในแต่ละสัปดาห์</legend><div className="mt-2 flex flex-wrap gap-3">{weekdayLabels.map((label, index) => <label key={label} className="flex min-h-12 items-center gap-2"><input type="checkbox" value={index + 1} {...form.register('weekdays')} className="h-5 w-5"/>{label}</label>)}</div><span className="text-xs text-danger">{errors.weekdays?.message}</span></fieldset>
        : <label className={labelClass}>วันที่ของเดือน (1–28)<input type="number" {...form.register('dayOfMonth')} className={fieldClass}/><span className="text-xs text-danger">{errors.dayOfMonth?.message}</span></label>}
      <label className={labelClass}>เวลาเริ่ม<input type="time" {...form.register('windowStart')} className={fieldClass}/></label>
      <label className={labelClass}>เวลาสิ้นสุด<input type="time" {...form.register('windowEnd')} className={fieldClass}/><span className="text-xs text-danger">{errors.windowEnd?.message}</span></label>
      <label className={`${labelClass} md:col-span-2`}>เป้าหมาย<textarea {...form.register('goalsSummary')} className={fieldClass}/><span className="text-xs text-danger">{errors.goalsSummary?.message}</span></label>
      <label className={`${labelClass} md:col-span-2`}>คำแนะนำกิจกรรม<textarea {...form.register('instructions')} className={fieldClass}/><span className="text-xs text-danger">{errors.instructions?.message}</span></label>
      <div className="md:col-span-2"><Button type="submit" disabled={form.formState.isSubmitting}>บันทึกร่าง</Button><OutcomeMessage outcome={outcome}/></div>
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
