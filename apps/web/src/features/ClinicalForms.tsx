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

/** Barthel ADL in the unit's own wording (transfer levels in the standard order: more help, fewer points). */
export const ADL_ITEMS: Array<{ key: AdlKey; title: string; hint?: string; levels: string[] }> = [
  { key: 'feeding', title: '1. รับประทานอาหาร', hint: 'เมื่อเตรียมสำรับไว้ให้เรียบร้อยต่อหน้า', levels: [
    'ไม่สามารถตักอาหารเข้าปากได้',
    'ตักอาหารเองได้ แต่ต้องมีคนช่วย เช่น ช่วยใช้ช้อนตักเตรียมให้/ตัดเป็นชิ้นเล็ก ๆ ให้',
    'ตักอาหารและช่วยตัวเองได้เป็นปกติ'] },
  { key: 'grooming', title: '2. ล้างหน้า หวีผม แปรงฟัน โกนหนวด', hint: 'ในระยะเวลา 24–48 ชั่วโมงที่ผ่านมา', levels: [
    'ต้องการความช่วยเหลือ',
    'ทำเองได้ (รวมทั้งที่ทำได้เองถ้าเตรียมอุปกรณ์ไว้ให้)'] },
  { key: 'transfer', title: '3. ลุกนั่งจากที่นอน หรือจากเตียงไปยังเก้าอี้', levels: [
    'ไม่สามารถนั่งได้ (นั่งแล้วจะล้มเสมอ) หรือต้องใช้คนสองคนช่วยกันยกขึ้น',
    'ต้องการความช่วยเหลืออย่างมากจึงจะนั่งได้ เช่น ต้องใช้คนที่แข็งแรงหรือมีทักษะ 1 คน หรือใช้คนทั่วไป 2 คนพยุงหรือดันขึ้นมาจึงจะนั่งอยู่ได้',
    'ต้องการความช่วยเหลือบ้าง เช่น บอกให้ทำตาม หรือช่วยพยุงเล็กน้อย หรือต้องมีคนดูแลเพื่อความปลอดภัย',
    'ทำได้เอง'] },
  { key: 'toiletUse', title: '4. การใช้ห้องน้ำ', levels: [
    'ช่วยตัวเองไม่ได้',
    'ทำเองได้บ้าง (อย่างน้อยทำความสะอาดตัวเองได้หลังจากเสร็จธุระ) แต่ต้องการความช่วยเหลือในบางสิ่ง',
    'ช่วยตัวเองได้ดี (ขึ้นนั่งและลงจากโถส้วมเองได้ ทำความสะอาดได้เรียบร้อยหลังจากเสร็จธุระ ถอดใส่เสื้อผ้าได้เรียบร้อย)'] },
  { key: 'mobility', title: '5. การเคลื่อนที่ภายในห้องหรือบ้าน', levels: [
    'เคลื่อนที่ไปไหนไม่ได้',
    'ต้องใช้รถเข็นช่วยตัวเองให้เคลื่อนที่ได้เอง (ไม่ต้องมีคนเข็นให้) และจะต้องเข้าออกมุมห้องหรือประตูได้',
    'เดินหรือเคลื่อนที่โดยมีคนช่วย เช่น พยุง หรือบอกให้ทำตาม หรือต้องให้ความสนใจดูแลเพื่อความปลอดภัย',
    'เดินหรือเคลื่อนที่ได้เอง'] },
  { key: 'dressing', title: '6. การสวมใส่เสื้อผ้า', levels: [
    'ต้องมีคนสวมใส่ให้ ช่วยตัวเองแทบไม่ได้หรือได้น้อย',
    'ช่วยตัวเองได้ประมาณร้อยละ 50 ที่เหลือต้องมีคนช่วย',
    'ช่วยตัวเองได้ดี (รวมทั้งการติดกระดุม รูดซิบ หรือใช้เสื้อผ้าที่ดัดแปลงให้เหมาะสมก็ได้)'] },
  { key: 'stairs', title: '7. การขึ้นลงบันได 1 ชั้น', levels: [
    'ไม่สามารถทำได้',
    'ต้องการคนช่วย',
    'ขึ้นลงได้เอง (ถ้าต้องใช้เครื่องช่วยเดิน เช่น walker จะต้องเอาขึ้นลงได้ด้วย)'] },
  { key: 'bathing', title: '8. การอาบน้ำ', levels: [
    'ต้องมีคนช่วยหรือทำให้',
    'อาบน้ำเองได้'] },
  { key: 'bowels', title: '9. การกลั้นการถ่ายอุจจาระ', hint: 'ในระยะ 1 สัปดาห์ที่ผ่านมา', levels: [
    'กลั้นไม่ได้ หรือต้องการการสวนอุจจาระอยู่เสมอ',
    'กลั้นไม่ได้บางครั้ง (เป็นน้อยกว่า 1 ครั้งต่อสัปดาห์)',
    'กลั้นได้ปกติ'] },
  { key: 'bladder', title: '10. การกลั้นปัสสาวะ', hint: 'ในระยะ 1 สัปดาห์ที่ผ่านมา', levels: [
    'กลั้นไม่ได้ หรือใส่สายสวนปัสสาวะแต่ไม่สามารถดูแลเองได้',
    'กลั้นไม่ได้บางครั้ง (เป็นน้อยกว่าวันละ 1 ครั้ง)',
    'กลั้นได้เป็นปกติ'] }
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

type Observation = z.infer<typeof ltcObservationSchema>;

export interface Choice<T> { value: T; label: string; detail: string }

const UNKNOWN_CHOICE = { value: 'UNKNOWN', label: 'ยังไม่ทราบ / ยังไม่ได้ประเมิน', detail: 'ระบบจะไม่แนะนำกลุ่มจนกว่าจะประเมินข้อนี้' } as const;

export const OBSERVATION_QUESTIONS: { [K in keyof Observation]: { title: string; hint: string; choices: Array<Choice<Observation[K]>> } } = {
  mobilityStatus: { title: '1. การเคลื่อนไหว', hint: 'ความสามารถในการลุก นั่ง เดิน หรือเคลื่อนที่ในชีวิตประจำวัน', choices: [
    { value: 'INDEPENDENT', label: 'เคลื่อนไหวได้เอง', detail: 'ลุก นั่ง เดินได้เอง หรือใช้อุปกรณ์ช่วยเดินได้เอง' },
    { value: 'ASSISTED', label: 'เคลื่อนไหวได้บ้าง ต้องมีคนช่วย', detail: 'ต้องมีคนพยุง ประคอง หรือคอยดูแลเพื่อความปลอดภัย แต่ยังเคลื่อนที่ได้' },
    { value: 'DEPENDENT', label: 'เคลื่อนไหวเองไม่ได้', detail: 'ติดเตียง หรือต้องมีผู้อื่นทำให้เกือบทั้งหมด' },
    UNKNOWN_CHOICE] },
  cognitiveStatus: { title: '2. ภาวะสับสนทางสมอง (การรับรู้)', hint: 'เช่น สับสนเรื่องเวลา สถานที่ บุคคล หลงลืมจนเป็นอันตราย หรือมีพฤติกรรมที่เป็นปัญหา', choices: [
    { value: 'NO_SIGNIFICANT_DISTURBANCE', label: 'ไม่มีภาวะสับสนที่สำคัญ', detail: 'รับรู้และสื่อสารได้ตามปกติ หรือผิดปกติเล็กน้อยที่ไม่กระทบการดูแล' },
    { value: 'DISTURBANCE', label: 'มีภาวะสับสนทางสมอง', detail: 'มีปัญหาการรับรู้หรือพฤติกรรมที่ต้องดูแลหรือเฝ้าระวังเพิ่ม' },
    UNKNOWN_CHOICE] },
  terminalStatus: { title: '3. ความเจ็บป่วยรุนแรงหรือระยะท้ายของชีวิต', hint: 'อ้างอิงการวินิจฉัยหรือความเห็นของแพทย์ ระบบไม่ได้วินิจฉัยเอง', choices: [
    { value: 'NOT_CONFIRMED', label: 'ไม่อยู่ในระยะท้าย', detail: 'ไม่มีการยืนยันว่าป่วยรุนแรงหรืออยู่ในระยะท้ายของชีวิต' },
    { value: 'CONFIRMED', label: 'ป่วยรุนแรงหรืออยู่ในระยะท้ายของชีวิต (ยืนยันแล้ว)', detail: 'มีการยืนยันจากแพทย์หรือทีมดูแลแบบประคับประคอง' },
    UNKNOWN_CHOICE] }
};

export const LTC_GROUPS: Array<Choice<number>> = [
  { value: 1, label: 'กลุ่ม 1', detail: 'เคลื่อนไหวได้บ้าง อาจมีปัญหาการกินหรือการขับถ่าย แต่ไม่มีภาวะสับสนทางสมอง' },
  { value: 2, label: 'กลุ่ม 2', detail: 'เหมือนกลุ่ม 1 แต่มีภาวะสับสนทางสมอง' },
  { value: 3, label: 'กลุ่ม 3', detail: 'เคลื่อนไหวเองไม่ได้ อาจมีปัญหาการกินหรือการขับถ่าย หรือมีอาการเจ็บป่วยรุนแรง' },
  { value: 4, label: 'กลุ่ม 4', detail: 'เหมือนกลุ่ม 3 และป่วยรุนแรงหรืออยู่ในระยะท้ายของชีวิต' }
];

const SUGGESTION_REASONS: Record<string, string> = {
  AMBIGUOUS_INPUT: 'ยังมีข้อที่ตอบว่า "ยังไม่ทราบ" ระบบจึงไม่แนะนำกลุ่ม CM ต้องพิจารณาเอง',
  INVALID_ADL: 'คะแนน ADL ไม่อยู่ในช่วง 0–20',
  DEPENDENT_TERMINAL: 'เคลื่อนไหวเองไม่ได้ และป่วยรุนแรงหรืออยู่ในระยะท้าย',
  DEPENDENT_NOT_TERMINAL: 'เคลื่อนไหวเองไม่ได้ แต่ไม่อยู่ในระยะท้าย',
  MOBILE_COGNITIVE_DISTURBANCE: 'ยังเคลื่อนไหวได้ และมีภาวะสับสนทางสมอง',
  MOBILE_NO_COGNITIVE_DISTURBANCE: 'ยังเคลื่อนไหวได้ และไม่มีภาวะสับสนทางสมอง'
};

export function ChoiceCards<T extends string | number>({ name, choices, selected, highlight, onSelect }: { name: string; choices: Array<Choice<T>>; selected: T | undefined; highlight?: T | null; onSelect: (value: T) => void }) {
  return <div className="mt-1 space-y-2">{choices.map((choice) => <label key={String(choice.value)} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-2 ${selected === choice.value ? 'border-primary bg-sky-50' : 'border-slate-200'}`}>
    <input type="radio" name={name} checked={selected === choice.value} onChange={() => onSelect(choice.value)} className="mt-1 h-5 w-5"/>
    <span className="flex-1"><span className="font-semibold">{choice.label}</span>{highlight === choice.value && <span className="ml-2"><Status tone="warning">ระบบแนะนำ</Status></span>}<span className="block text-sm text-slate-600">{choice.detail}</span></span>
  </label>)}</div>;
}

export function ClassificationForm() {
  const { id: patientId = '' } = useParams();
  const [outcome, setOutcome] = useState<Outcome>(null);
  // No default group: the CM chooses one deliberately after seeing the suggestion.
  const form = useForm<z.infer<typeof classificationSchema>>({ resolver: zodResolver(classificationSchema), defaultValues: { mobilityStatus: 'UNKNOWN', cognitiveStatus: 'UNKNOWN', terminalStatus: 'UNKNOWN', rationale: '' } });
  const values = form.watch();
  const { mobilityStatus, cognitiveStatus, terminalStatus, groupNumber } = values;
  // Preview only: the suggestion rules do not depend on the ADL score. The server re-runs them
  // against the latest approved ADL assessment when the CM confirms.
  const suggestion = suggestLtcGroup({ adlTotal: 0, mobilityStatus, cognitiveStatus, terminalStatus });
  const selectedGroup = groupNumber === undefined ? undefined : Number(groupNumber);
  const overridesSuggestion = suggestion.groupNumber !== null && selectedGroup !== undefined && selectedGroup !== suggestion.groupNumber;
  const errors = form.formState.errors;
  return <FormPage title="ยืนยันกลุ่ม LTC" description="ตอบ 3 ข้อตามสภาพปัจจุบัน ระบบจะแนะนำกลุ่ม แต่ CM ต้องเป็นผู้เลือกและระบุเหตุผลเสมอ">
    <PatientBanner patientId={patientId}/>
    <p className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">ต้องมีแบบประเมิน ADL ที่อนุมัติแล้วก่อน ระบบจะบันทึกคะแนน ADL ล่าสุดของผู้รับบริการไว้กับผลจัดกลุ่ม</p>
    <form onSubmit={form.handleSubmit(({ groupNumber: confirmedGroup, rationale, ...observation }) => attempt(setOutcome, () => post('/ltc-classifications', { patientId, observation, groupNumber: confirmedGroup, rationale }), 'ยืนยันกลุ่มแล้ว'))} className="space-y-4">
      {(Object.keys(OBSERVATION_QUESTIONS) as Array<keyof Observation>).map((key) => {
        const question = OBSERVATION_QUESTIONS[key];
        return <fieldset key={key} className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 font-bold">{question.title}</legend><p className="text-sm text-slate-500">{question.hint}</p>
          <ChoiceCards name={key} choices={question.choices as Array<Choice<string>>} selected={values[key]} onSelect={(value) => form.setValue(key, value as never, { shouldValidate: true })}/>
        </fieldset>;
      })}
      <div className="rounded-xl bg-amber-50 p-4"><p className="font-bold">คำแนะนำของระบบ: {suggestion.groupNumber ? <Status tone="warning">กลุ่ม {suggestion.groupNumber}</Status> : <Status tone="danger">ต้องให้ CM พิจารณา</Status>}</p><p className="mt-1 text-sm text-slate-700">{SUGGESTION_REASONS[suggestion.rationaleCode] ?? suggestion.rationaleCode}</p></div>
      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 font-bold">4. กลุ่มที่ CM ยืนยัน</legend>
        <ChoiceCards name="groupNumber" choices={LTC_GROUPS} selected={selectedGroup} highlight={suggestion.groupNumber} onSelect={(value) => form.setValue('groupNumber', value, { shouldValidate: true })}/>
        {errors.groupNumber && <p className="mt-1 text-xs text-danger">กรุณาเลือกกลุ่ม</p>}
      </fieldset>
      <label className={labelClass}>เหตุผลประกอบการยืนยัน<span className="block text-xs font-normal text-slate-500">{overridesSuggestion ? 'กลุ่มที่เลือกต่างจากคำแนะนำของระบบ กรุณาอธิบายเหตุผลทางคลินิก' : 'สรุปข้อมูลที่ใช้ตัดสิน อย่างน้อย 10 ตัวอักษร'}</span><textarea {...form.register('rationale')} className={fieldClass}/><span className="text-xs text-danger">{errors.rationale?.message}</span></label>
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

export const SERVICE_TYPES: Array<{ label: string; detail: string; example: string }> = [
  { label: 'ดูแลกิจวัตรประจำวัน', detail: 'ช่วยอาบน้ำ เช็ดตัว แต่งตัว ป้อนอาหาร ขับถ่าย', example: 'เช็ดตัว เปลี่ยนเสื้อผ้า ช่วยป้อนอาหารมื้อเช้า ดูแลความสะอาดหลังขับถ่าย' },
  { label: 'กายภาพบำบัดและฝึกการเคลื่อนไหว', detail: 'ฝึกลุกนั่ง ยืน เดิน และบริหารข้อเพื่อป้องกันข้อติด', example: 'บริหารข้อแขนขาทั้งสองข้าง ข้างละ 10 ครั้ง ฝึกลุกนั่งและยืนโดยมีผู้ช่วยพยุง' },
  { label: 'ป้องกันแผลกดทับ', detail: 'พลิกตะแคงตัว จัดท่า และตรวจดูผิวหนังบริเวณปุ่มกระดูก', example: 'สอนญาติพลิกตะแคงตัวทุก 2 ชั่วโมง ตรวจผิวหนังบริเวณก้นกบ สะโพก และส้นเท้า' },
  { label: 'ติดตามสัญญาณชีพและอาการ', detail: 'วัดอุณหภูมิ ชีพจร และสังเกตอาการเปลี่ยนแปลงเพื่อแจ้ง CM', example: 'วัดอุณหภูมิและชีพจร สอบถามการกิน การนอน และอาการผิดปกติ แจ้ง CM หากพบความผิดปกติ' },
  { label: 'ดูแลการใช้ยา', detail: 'ตรวจว่าได้รับยาตามแพทย์สั่ง ไม่ปรับยาเอง', example: 'ตรวจกล่องยาว่ารับประทานครบตามแพทย์สั่ง บันทึกยาที่ขาดหรือเหลือผิดปกติ' },
  { label: 'กระตุ้นความจำและสุขภาพจิต', detail: 'พูดคุย ทำกิจกรรมกระตุ้นการรับรู้ และสังเกตอารมณ์', example: 'พูดคุยเรื่องวันเวลาและครอบครัว ทำกิจกรรมเบา ๆ 15 นาที สังเกตอารมณ์และการนอน' },
  { label: 'ดูแลแบบประคับประคอง', detail: 'บรรเทาความไม่สุขสบายและสนับสนุนครอบครัวตามแผนของทีม', example: 'จัดท่าให้สุขสบาย ดูแลช่องปากและผิวหนัง พูดคุยให้กำลังใจผู้ดูแลในครอบครัว' }
];
const OTHER_SERVICE = 'อื่น ๆ (ระบุเอง)';

const PLAN_LENGTHS: Array<[string, number]> = [['3 เดือน', 3], ['6 เดือน', 6], ['1 ปี', 12]];
const TIME_WINDOWS: Array<[string, string, string]> = [['ช่วงเช้า', '09:00', '12:00'], ['ช่วงบ่าย', '13:00', '16:00'], ['ทั้งวันทำการ', '08:30', '16:30']];

/** The day before the same date `months` later, so "3 months from 1 Jan" ends on 31 Mar. */
export function planEndDate(from: string, months: number): string {
  const [year, month, day] = from.split('-').map(Number);
  const end = new Date(Date.UTC(year!, month! - 1 + months, day!));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

const hintClass = 'block text-xs font-normal text-slate-500';
const chipClass = 'min-h-10 rounded-lg border border-slate-300 px-3 text-sm hover:bg-sky-50';

export function CarePlanForm() {
  const [searchParams] = useSearchParams();
  const presetPatient = searchParams.get('patientId') ?? '';
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [draft, setDraft] = useState<DraftPlan | null>(null);
  const [serviceChoice, setServiceChoice] = useState('');
  const today = todayInBangkok();
  const form = useForm<CarePlanValues>({ resolver: zodResolver(carePlanSchema), defaultValues: { patientId: presetPatient, rulesetId: isDemoMode ? DEMO_RULESET_ID : '', effectiveFrom: today, effectiveTo: planEndDate(today, 3), goalsSummary: '', serviceType: '', instructions: '', unit: 'WEEK', weekdays: [], windowStart: '09:00', windowEnd: '12:00' } });
  const { unit, patientId, effectiveFrom, windowStart, windowEnd } = form.watch();
  const errors = form.formState.errors;
  const service = SERVICE_TYPES.find((item) => item.label === serviceChoice);
  const chooseService = (label: string) => {
    setServiceChoice(label);
    form.setValue('serviceType', label === OTHER_SERVICE ? '' : label, { shouldValidate: form.formState.isSubmitted });
  };
  return <FormPage title="สร้าง Care Plan" description="บันทึกเป็นร่าง (DRAFT) ก่อน เมื่ออนุมัติแล้วระบบจึงสร้างตารางเยี่ยมให้ผู้ดูแลตามรอบที่กำหนด">
    {patientId && <PatientBanner patientId={patientId}/>}
    <form onSubmit={form.handleSubmit((values) => attempt(setOutcome, async () => setDraft(await post<DraftPlan>('/care-plans', toCarePlanRequest(values))), 'สร้างร่างแผนแล้ว'))} className="space-y-4">
      {!presetPatient && <label className={labelClass}>รหัสผู้รับบริการ<span className={hintClass}>เปิดจากการ์ดผู้รับบริการเพื่อกรอกให้อัตโนมัติ</span><input {...form.register('patientId')} className={fieldClass}/><span className="text-xs text-danger">{errors.patientId?.message}</span></label>}

      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 font-bold">1. ช่วงเวลาของแผน</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={labelClass}>เริ่มวันที่<input type="date" {...form.register('effectiveFrom')} className={fieldClass}/><span className="text-xs text-danger">{errors.effectiveFrom?.message}</span></label>
          <label className={labelClass}>ถึงวันที่<input type="date" {...form.register('effectiveTo')} className={fieldClass}/><span className="text-xs text-danger">{errors.effectiveTo?.message}</span></label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-sm text-slate-600">ระยะเวลา:</span>{PLAN_LENGTHS.map(([label, months]) => <button key={label} type="button" disabled={!effectiveFrom} onClick={() => form.setValue('effectiveTo', planEndDate(effectiveFrom, months), { shouldValidate: true })} className={chipClass}>{label}</button>)}</div>
        <label className={`${labelClass} mt-3`}>ชุดกฎบริการที่อนุมัติแล้ว<span className={hintClass}>กำหนดความถี่บริการที่เบิกได้ตามกลุ่ม LTC{isDemoMode ? ` · ระบบ DEMO ใช้ ${DEMO_RULESET_ID}` : ''}</span><input {...form.register('rulesetId')} className={fieldClass}/><span className="text-xs text-danger">{errors.rulesetId?.message}</span></label>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 font-bold">2. ประเภทบริการ</legend>
        <div className="mt-1 grid gap-2 md:grid-cols-2">{[...SERVICE_TYPES, { label: OTHER_SERVICE, detail: 'บริการที่ไม่มีในรายการ ระบุชื่อบริการเอง', example: '' }].map((item) => <label key={item.label} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-2 ${serviceChoice === item.label ? 'border-primary bg-sky-50' : 'border-slate-200'}`}>
          <input type="radio" name="serviceChoice" checked={serviceChoice === item.label} onChange={() => chooseService(item.label)} className="mt-1 h-5 w-5"/>
          <span><span className="font-semibold">{item.label}</span><span className="block text-sm text-slate-600">{item.detail}</span></span>
        </label>)}</div>
        {serviceChoice === OTHER_SERVICE && <label className={`${labelClass} mt-3`}>ชื่อบริการ<input {...form.register('serviceType')} className={fieldClass}/></label>}
        <span className="text-xs text-danger">{errors.serviceType?.message}</span>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 font-bold">3. รอบการเยี่ยม</legend>
        <div className="grid gap-2 md:grid-cols-2">{([['WEEK', 'รายสัปดาห์', 'เยี่ยมตามวันที่เลือกในทุกสัปดาห์'], ['MONTH', 'รายเดือน', 'เยี่ยมเดือนละ 1 ครั้งตามวันที่กำหนด']] as const).map(([value, label, detail]) => <label key={value} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-2 ${unit === value ? 'border-primary bg-sky-50' : 'border-slate-200'}`}>
          <input type="radio" value={value} {...form.register('unit')} className="mt-1 h-5 w-5"/><span><span className="font-semibold">{label}</span><span className="block text-sm text-slate-600">{detail}</span></span>
        </label>)}</div>
        {unit === 'WEEK'
          ? <div className="mt-3"><p className={labelClass}>วันที่เยี่ยมในแต่ละสัปดาห์<span className={hintClass}>เลือกได้หลายวัน จำนวนวันที่เลือกคือจำนวนครั้งต่อสัปดาห์</span></p><div className="mt-2 flex flex-wrap gap-3">{weekdayLabels.map((label, index) => <label key={label} className="flex min-h-12 items-center gap-2"><input type="checkbox" value={index + 1} {...form.register('weekdays')} className="h-5 w-5"/>{label}</label>)}</div><span className="text-xs text-danger">{errors.weekdays?.message}</span></div>
          : <label className={`${labelClass} mt-3`}>วันที่ของเดือน (1–28)<span className={hintClass}>จำกัดไม่เกินวันที่ 28 เพื่อให้มีทุกเดือน</span><input type="number" min={1} max={28} {...form.register('dayOfMonth')} className={fieldClass}/><span className="text-xs text-danger">{errors.dayOfMonth?.message}</span></label>}
        <p className={`${labelClass} mt-3`}>ช่วงเวลาที่เยี่ยม<span className={hintClass}>ระบบไม่เลื่อนนัดในวันหยุดให้อัตโนมัติ</span></p>
        <div className="mt-2 flex flex-wrap gap-2">{TIME_WINDOWS.map(([label, start, end]) => <button key={label} type="button" onClick={() => { form.setValue('windowStart', start); form.setValue('windowEnd', end, { shouldValidate: true }); }} className={`${chipClass} ${windowStart === start && windowEnd === end ? 'border-primary bg-sky-50 font-semibold' : ''}`}>{label} {start}–{end}</button>)}</div>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <label className={labelClass}>เวลาเริ่ม<input type="time" {...form.register('windowStart')} className={fieldClass}/></label>
          <label className={labelClass}>เวลาสิ้นสุด<input type="time" {...form.register('windowEnd')} className={fieldClass}/><span className="text-xs text-danger">{errors.windowEnd?.message}</span></label>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 font-bold">4. เป้าหมายและกิจกรรม</legend>
        <label className={labelClass}>เป้าหมายของแผน<span className={hintClass}>สิ่งที่ต้องการให้เกิดขึ้นและวัดผลได้ เช่น "ไม่เกิดแผลกดทับใหม่ภายใน 3 เดือน" หรือ "ลุกนั่งเองได้โดยมีคนช่วยพยุงเล็กน้อย"</span><textarea {...form.register('goalsSummary')} className={fieldClass}/><span className="text-xs text-danger">{errors.goalsSummary?.message}</span></label>
        <label className={`${labelClass} mt-3`}>คำแนะนำกิจกรรมสำหรับผู้ดูแล<span className={hintClass}>สิ่งที่ CG ต้องทำในแต่ละครั้ง เขียนให้ทำตามได้ทันที</span><textarea {...form.register('instructions')} placeholder={service ? `ตัวอย่าง: ${service.example}` : ''} className={fieldClass}/><span className="text-xs text-danger">{errors.instructions?.message}</span></label>
        {service && <button type="button" onClick={() => form.setValue('instructions', service.example, { shouldValidate: true })} className={`${chipClass} mt-2`}>ใช้ข้อความตัวอย่าง</button>}
      </fieldset>

      <div><Button type="submit" disabled={form.formState.isSubmitting || draft !== null}>บันทึกร่าง</Button><OutcomeMessage outcome={outcome}/></div>
      {draft && <ActivatePlan plan={draft}/>}
    </form>
  </FormPage>;
}
