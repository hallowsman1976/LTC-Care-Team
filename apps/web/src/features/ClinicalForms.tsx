import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { adlAssessmentItemsSchema, calculateAdlTotal, patientCreateSchema, suggestLtcGroup } from '@smart-ltc/shared';
import { api, isDemoMode } from '../lib/api';
import { Button, Card, ErrorState, Status } from '../components/ui';

const fieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2';
const labelClass = 'block text-sm font-semibold text-slate-700';

function FormPage({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl space-y-5"><div><h2 className="text-2xl font-bold">{title}</h2><p className="text-slate-600">{description}</p></div><Card>{children}</Card></div>;
}

export function PatientForm() {
  const [result, setResult] = useState('');
  const form = useForm<z.infer<typeof patientCreateSchema>>({
    resolver: zodResolver(patientCreateSchema),
    defaultValues: { localCode: '', hn: '', cid: '', fullName: '', birthDate: '', sex: 'UNKNOWN', address: '', village: '', phone: '', legalBasis: undefined, privacyNoticeVersion: import.meta.env.VITE_PRIVACY_NOTICE_VERSION || '' }
  });
  const submit = form.handleSubmit(async (values) => {
    setResult('');
    try { await api('/patients', { method: 'POST', body: JSON.stringify(values) }); setResult(isDemoMode ? 'บันทึกข้อมูลจำลองแล้ว' : 'บันทึกผู้รับบริการและฐานการประมวลผลแล้ว'); }
    catch (error) { setResult(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'); }
  });
  return <FormPage title="เพิ่มผู้รับบริการ" description={isDemoMode ? 'ห้ามกรอกข้อมูลบุคคลจริงในระบบ DEMO' : 'กรอกเฉพาะข้อมูลที่จำเป็นตามฐานการประมวลผลที่หน่วยบริการอนุมัติ'}>
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      {([['localCode', 'รหัสท้องถิ่น'], ['hn', 'HN'], ['cid', isDemoMode ? 'CID จำลอง 13 หลัก' : 'เลขประจำตัวประชาชน 13 หลัก'], ['fullName', isDemoMode ? 'ชื่อ–สกุลจำลอง' : 'ชื่อ–สกุล'], ['birthDate', 'วันเกิด']] as const).map(([name, label]) => <label className={labelClass} key={name}>{label}<input type={name === 'birthDate' ? 'date' : 'text'} {...form.register(name)} className={fieldClass}/><span className="text-xs text-danger">{form.formState.errors[name]?.message}</span></label>)}
      <label className={labelClass}>เพศ<select {...form.register('sex')} className={fieldClass}><option value="UNKNOWN">ไม่ระบุ</option><option value="FEMALE">หญิง</option><option value="MALE">ชาย</option><option value="OTHER">อื่น ๆ</option></select></label>
      <label className={`${labelClass} md:col-span-2`}>{isDemoMode ? 'ที่อยู่จำลอง' : 'ที่อยู่สำหรับให้บริการ'}<textarea {...form.register('address')} className={fieldClass}/><span className="text-xs text-danger">{form.formState.errors.address?.message}</span></label>
      <label className={labelClass}>หมู่บ้าน<input {...form.register('village')} className={fieldClass}/></label>
      <label className={labelClass}>{isDemoMode ? 'โทรศัพท์จำลอง' : 'โทรศัพท์'}<input {...form.register('phone')} className={fieldClass}/></label>
      {!isDemoMode && <><label className={labelClass}>ฐานการประมวลผล<select {...form.register('legalBasis')} className={fieldClass}><option value="">กรุณาเลือก</option><option value="PUBLIC_HEALTH">ภารกิจด้านสาธารณสุข</option><option value="MEDICAL_CARE">การให้บริการด้านสุขภาพ</option><option value="LEGAL_OBLIGATION">หน้าที่ตามกฎหมาย</option><option value="EXPLICIT_CONSENT">ความยินยอมโดยชัดแจ้ง</option></select></label><label className={labelClass}>เวอร์ชันประกาศความเป็นส่วนตัว<input {...form.register('privacyNoticeVersion')} readOnly className={fieldClass}/></label></>}
      <div className="md:col-span-2"><Button type="submit" disabled={form.formState.isSubmitting}>บันทึกผู้รับบริการ</Button>{result && <p role="status" className="mt-3">{result}</p>}</div>
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
  const { id = '' } = useParams();
  const [message, setMessage] = useState('');
  const form = useForm<z.infer<typeof adlAssessmentItemsSchema>>({ resolver: zodResolver(adlAssessmentItemsSchema), defaultValues: Object.fromEntries(adlLabels.map(([key]) => [key, 0])) as z.infer<typeof adlAssessmentItemsSchema> });
  const values = form.watch();
  const total = adlAssessmentItemsSchema.safeParse(values).success ? calculateAdlTotal(values) : 0;
  return <FormPage title="ประเมิน Barthel ADL" description="ประเมินสิ่งที่ทำได้จริงและระบบจะคำนวณคะแนนใหม่ฝั่ง server">
    <form onSubmit={form.handleSubmit(async (items) => { try { await api('/internal/gas/adl.create', { method: 'POST', body: JSON.stringify({ episodeId: id, assessmentDate: new Date().toISOString().slice(0, 10), items }) }); setMessage('ส่งแบบประเมินแล้ว'); } catch (error) { setMessage(error instanceof Error ? error.message : 'ส่งไม่สำเร็จ'); } })} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">{adlLabels.map(([name, label, options]) => <label key={name} className={labelClass}>{label}<select {...form.register(name, { valueAsNumber: true })} className={fieldClass}>{options.map((score) => <option key={score} value={score}>{score} คะแนน</option>)}</select></label>)}</div>
      <div className="flex items-center justify-between rounded-xl bg-sky-50 p-4"><span className="font-bold">คะแนนรวม</span><span aria-live="polite" className="text-2xl font-bold text-primary">{total}/20</span></div>
      <Button type="submit" disabled={form.formState.isSubmitting}>อนุมัติแบบประเมิน</Button>{message && <p role="status">{message}</p>}
    </form>
  </FormPage>;
}

const classificationSchema = z.object({
  adlTotal: z.coerce.number().int().min(0).max(20), mobilityStatus: z.enum(['INDEPENDENT', 'ASSISTED', 'DEPENDENT', 'UNKNOWN']),
  cognitiveStatus: z.enum(['NO_SIGNIFICANT_DISTURBANCE', 'DISTURBANCE', 'UNKNOWN']), terminalStatus: z.enum(['CONFIRMED', 'NOT_CONFIRMED', 'UNKNOWN']),
  groupNumber: z.coerce.number().int().min(1).max(4), rationale: z.string().trim().min(10)
});

export function ClassificationForm() {
  const { id = '' } = useParams();
  const [message, setMessage] = useState('');
  const form = useForm<z.infer<typeof classificationSchema>>({ resolver: zodResolver(classificationSchema), defaultValues: { adlTotal: 0, mobilityStatus: 'UNKNOWN', cognitiveStatus: 'UNKNOWN', terminalStatus: 'UNKNOWN', groupNumber: 1, rationale: '' } });
  const input = form.watch();
  const suggestion = suggestLtcGroup(input);
  return <FormPage title="ยืนยันกลุ่ม LTC" description="คำแนะนำไม่ใช่การยืนยัน CM ต้องเลือกและระบุเหตุผลเสมอ">
    <form onSubmit={form.handleSubmit(async ({ groupNumber, rationale, ...decisionInput }) => { try { await api('/internal/gas/classification.confirm', { method: 'POST', body: JSON.stringify({ episodeId: id, assessmentId: 'selected-assessment', input: decisionInput, groupNumber, rationale }) }); setMessage('ยืนยันกลุ่มแล้ว'); } catch (error) { setMessage(error instanceof Error ? error.message : 'ส่งไม่สำเร็จ'); } })} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>คะแนน ADL<input type="number" {...form.register('adlTotal')} className={fieldClass}/></label>
        <label className={labelClass}>การเคลื่อนไหว<select {...form.register('mobilityStatus')} className={fieldClass}><option value="UNKNOWN">ยังไม่ทราบ</option><option value="INDEPENDENT">อิสระ</option><option value="ASSISTED">ต้องช่วย</option><option value="DEPENDENT">ไม่สามารถเอง</option></select></label>
        <label className={labelClass}>การรับรู้<select {...form.register('cognitiveStatus')} className={fieldClass}><option value="UNKNOWN">ยังไม่ทราบ</option><option value="NO_SIGNIFICANT_DISTURBANCE">ไม่พบความผิดปกติสำคัญ</option><option value="DISTURBANCE">พบความผิดปกติ</option></select></label>
        <label className={labelClass}>ระยะสุดท้าย<select {...form.register('terminalStatus')} className={fieldClass}><option value="UNKNOWN">ยังไม่ทราบ</option><option value="NOT_CONFIRMED">ไม่ยืนยัน</option><option value="CONFIRMED">ยืนยันแล้ว</option></select></label>
      </div>
      <div className="rounded-xl bg-amber-50 p-4">คำแนะนำ: {suggestion.groupNumber ? <Status tone="warning">กลุ่ม {suggestion.groupNumber}</Status> : <Status tone="danger">ต้องให้ CM ทบทวน</Status>}</div>
      <label className={labelClass}>กลุ่มที่ CM ยืนยัน<select {...form.register('groupNumber')} className={fieldClass}>{[1,2,3,4].map((group) => <option value={group} key={group}>กลุ่ม {group}</option>)}</select></label>
      <label className={labelClass}>เหตุผล<textarea {...form.register('rationale')} className={fieldClass}/><span className="text-xs text-danger">{form.formState.errors.rationale?.message}</span></label>
      <Button type="submit">ยืนยันกลุ่ม</Button>{message && <p role="status">{message}</p>}
    </form>
  </FormPage>;
}

const carePlanSchema = z.object({ episodeId: z.string().min(1), rulesetId: z.string().min(1), effectiveFrom: z.string().date(), effectiveTo: z.string().date(), goalsSummary: z.string().min(10), serviceType: z.string().min(2), instructions: z.string().min(10), unit: z.enum(['WEEK', 'MONTH']), count: z.coerce.number().int().min(1).max(28) });
export function CarePlanForm() {
  const [message, setMessage] = useState('');
  const form = useForm<z.infer<typeof carePlanSchema>>({ resolver: zodResolver(carePlanSchema), defaultValues: { episodeId: '', rulesetId: '', effectiveFrom: '', effectiveTo: '', goalsSummary: '', serviceType: '', instructions: '', unit: 'WEEK', count: 1 } });
  return <FormPage title="สร้าง Care Plan" description="แผนเริ่มเป็น DRAFT และยังไม่สร้างตารางจนผ่านเงื่อนไข activation">
    <form onSubmit={form.handleSubmit(async (values) => { try { await api('/internal/gas/carePlan.create', { method: 'POST', body: JSON.stringify(values) }); setMessage('สร้างร่างแผนแล้ว'); } catch (error) { setMessage(error instanceof Error ? error.message : 'ส่งไม่สำเร็จ'); } })} className="grid gap-4 md:grid-cols-2">
      {([['episodeId','Episode ID'],['rulesetId','Approved ruleset ID'],['effectiveFrom','เริ่มวันที่'],['effectiveTo','ถึงวันที่'],['serviceType','ประเภทบริการ']] as const).map(([name,label]) => <label key={name} className={labelClass}>{label}<input type={name.startsWith('effective') ? 'date' : 'text'} {...form.register(name)} className={fieldClass}/></label>)}
      <label className={labelClass}>ความถี่<input type="number" {...form.register('count')} className={fieldClass}/></label><label className={labelClass}>หน่วย<select {...form.register('unit')} className={fieldClass}><option value="WEEK">สัปดาห์</option><option value="MONTH">เดือน</option></select></label>
      <label className={`${labelClass} md:col-span-2`}>เป้าหมาย<textarea {...form.register('goalsSummary')} className={fieldClass}/></label><label className={`${labelClass} md:col-span-2`}>คำแนะนำกิจกรรม<textarea {...form.register('instructions')} className={fieldClass}/></label>
      <div className="md:col-span-2"><Button type="submit">บันทึกร่าง</Button>{message && <p role="status" className="mt-3">{message}</p>}</div>
    </form>
  </FormPage>;
}

const visitSchema = z.object({ startedAt: z.string().min(1), endedAt: z.string().min(1), activityCompleted: z.boolean(), notes: z.string().max(2000), temperature: z.coerce.number().min(30).max(45).optional(), pulse: z.coerce.number().min(20).max(250).optional(), urgentFlag: z.boolean() });
export function VisitForm() {
  const { id = '' } = useParams();
  const [message, setMessage] = useState('');
  const form = useForm<z.infer<typeof visitSchema>>({ resolver: zodResolver(visitSchema), defaultValues: { startedAt: '', endedAt: '', activityCompleted: false, notes: '', urgentFlag: false } });
  return <FormPage title="บันทึกการเยี่ยม" description="ข้อมูลที่ส่งแล้วแก้ไม่ได้จนกว่า CM จะคืนรายการ">
    <form onSubmit={form.handleSubmit(async (values) => { try { await api('/internal/gas/visit.submit', { method: 'POST', body: JSON.stringify({ visitId: id, submissionId: crypto.randomUUID(), source: 'ONLINE', ...values, vitals: { temperature: values.temperature ? { value: values.temperature, unit: '°C' } : undefined, pulse: values.pulse ? { value: values.pulse, unit: 'bpm' } : undefined } }) }); setMessage('ส่งงานแล้วและได้รับ receipt'); } catch (error) { setMessage(error instanceof Error ? error.message : 'ส่งไม่สำเร็จ'); } })} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2"><label className={labelClass}>เริ่มจริง<input type="datetime-local" {...form.register('startedAt')} className={fieldClass}/></label><label className={labelClass}>เสร็จจริง<input type="datetime-local" {...form.register('endedAt')} className={fieldClass}/></label><label className={labelClass}>อุณหภูมิ (°C)<input type="number" step="0.1" {...form.register('temperature')} className={fieldClass}/></label><label className={labelClass}>ชีพจร (bpm)<input type="number" {...form.register('pulse')} className={fieldClass}/></label></div>
      <label className="flex min-h-12 items-center gap-3"><input type="checkbox" {...form.register('activityCompleted')} className="h-5 w-5"/>ทำกิจกรรมตามแผนครบ</label><label className="flex min-h-12 items-center gap-3"><input type="checkbox" {...form.register('urgentFlag')} className="h-5 w-5"/>พบประเด็นเร่งด่วน — แจ้ง CM ตามแนวทางหน่วยบริการ</label>
      <label className={labelClass}>บันทึก<textarea {...form.register('notes')} className={fieldClass}/></label>
      <Button type="submit">ตรวจทานและส่ง</Button>{message && (message.includes('สำเร็จ') ? <p role="status">{message}</p> : <ErrorState message={message}/>) }
    </form>
  </FormPage>;
}
