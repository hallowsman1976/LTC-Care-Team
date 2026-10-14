import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  BASIC_HEALTH_ACTIVITIES, calculateAdlTotal, calculateBmi, DAILY_CARE_ACTIVITIES, formatThaiDate, interpretBmi, interpretQ8, interpretQ9,
  needsSuicideAssessment, OTHER_CARE_ACTIVITIES, Q2_QUESTIONS, Q8_FOLLOW_UP, Q8_QUESTIONS, Q9_FREQUENCIES, Q9_QUESTIONS, RELATIONS, scoreQ8, sum,
  visitRecordSubmitSchema, type AdlItems, type ImageKind, type VisitContext
} from '@smart-ltc/shared';
import { post, postWithProgress, todayInBangkok } from '../lib/api';
import { compressImage, type PreparedImage } from '../lib/images';
import { SignaturePad } from '../components/SignaturePad';
import { Card, ErrorState, Loading } from '../components/ui';
import { ADL_ITEMS } from './ClinicalForms';

// The home-visit record. Scores are computed live with the same shared functions the server uses
// to recompute them. Images upload first, each with its own progress, then the record is sent.

const fieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100';
const labelClass = 'block text-sm font-semibold text-slate-700';
const hintClass = 'block text-xs font-normal text-slate-500';

interface ImageSlot { image: PreparedImage; progress: number; imageId?: string }
type Images = Partial<Record<ImageKind, ImageSlot>>;

interface FormState {
  visitDate: string; startTime: string; endTime: string;
  caregiverName: string; caregiverRelation: string; caregiverPhone: string;
  weightKg: string; heightCm: string;
  temperature: string; pulse: string; respiration: string; bloodPressure: string;
  adl: Partial<AdlItems>;
  q2: Array<boolean | null>; q9: Array<number | null>; q8: Array<boolean | null>; canControl: boolean | null;
  dailyCare: string[]; basicHealth: string[]; otherCare: string[];
  urgent: boolean | null; notes: string;
}

const nowTime = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

const initialState = (): FormState => ({
  visitDate: todayInBangkok(), startTime: nowTime(), endTime: '',
  caregiverName: '', caregiverRelation: '', caregiverPhone: '',
  weightKg: '', heightCm: '', temperature: '', pulse: '', respiration: '', bloodPressure: '',
  adl: {}, q2: [null, null], q9: Array(9).fill(null), q8: Array(8).fill(null), canControl: null,
  dailyCare: [], basicHealth: [], otherCare: [], urgent: null, notes: ''
});

const toNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));

export function parseBloodPressure(value: string): { systolic: number; diastolic: number } | null {
  const match = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*(mmhg)?\s*$/i.exec(value);
  return match ? { systolic: Number(match[1]), diastolic: Number(match[2]) } : null;
}

/** Where each validation problem is shown, and how it is named in the summary alert. */
const FIELD_LABELS: Record<string, string> = {
  visitDate: 'วันที่เยี่ยม', startTime: 'เวลาเยี่ยม', endTime: 'เวลาสิ้นสุด', caregiverName: 'ชื่อผู้ดูแล', caregiverRelation: 'ความสัมพันธ์',
  caregiverPhone: 'เบอร์ติดต่อ', weightKg: 'น้ำหนัก', heightCm: 'ส่วนสูง', 'vitals.temperature': 'อุณหภูมิ', 'vitals.pulse': 'ชีพจร',
  'vitals.respiration': 'การหายใจ', 'vitals.systolic': 'ความดันโลหิต', 'vitals.diastolic': 'ความดันโลหิต', adl: 'ADL', q2: '2Q', q9: '9Q', q8: '8Q',
  'q8.canControl': '8Q คำถามต่อข้อ 3', olderImageId: 'ภาพผู้สูงอายุ', serviceImageId: 'ภาพกิจกรรมการดูแล', signatureImageId: 'ลายมือชื่อ', urgentFlag: 'เรื่องเร่งด่วน'
};
const MESSAGES: Record<string, string> = {
  END_BEFORE_START: 'เวลาสิ้นสุดต้องหลังเวลาเยี่ยม', DIASTOLIC_NOT_BELOW_SYSTOLIC: 'ค่าตัวล่างต้องน้อยกว่าค่าตัวบน',
  Q9_REQUIRED: 'ตอบให้ครบทั้ง 9 ข้อ', Q8_REQUIRED: 'ตอบให้ครบทั้ง 8 ข้อ', Q8_FOLLOW_UP_REQUIRED: 'ตอบคำถามต่อของข้อ 3'
};
const fieldOf = (path: Array<string | number>) => {
  const joined = path.join('.');
  return FIELD_LABELS[joined] ? joined : String(path[0]);
};

function Section({ number, title, hint, children }: { number: number; title: string; hint?: string; children: ReactNode }) {
  return <Card>
    <h3 className="flex items-center gap-3 text-lg font-bold"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-white">{number}</span>{title}</h3>
    {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    <div className="mt-4">{children}</div>
  </Card>;
}

const FieldError = ({ message }: { message?: string | undefined }) => (message ? <span className="mt-1 block text-xs text-danger">{message}</span> : null);

function Result({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  const colours = { neutral: 'bg-slate-100 text-slate-800', warning: 'bg-amber-100 text-amber-900', danger: 'bg-red-100 text-red-800', success: 'bg-emerald-50 text-emerald-800' };
  return <div className={`rounded-xl p-3 ${colours[tone]}`}><p className="text-xs">{label}</p><p className="text-lg font-bold">{value}</p></div>;
}

function YesNo({ name, value, onChange, yes = 'มี', no = 'ไม่มี' }: { name: string; value: boolean | null; onChange: (value: boolean) => void; yes?: string; no?: string }) {
  return <div className="flex gap-2">{([[false, no], [true, yes]] as const).map(([option, label]) => <label key={label} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 ${value === option ? (option ? 'border-danger bg-red-50 font-semibold text-red-800' : 'border-primary bg-sky-50 font-semibold') : 'border-slate-300'}`}>
    <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} className="h-4 w-4"/>{label}
  </label>)}</div>;
}

function Checklist({ items, selected, onChange }: { items: readonly string[]; selected: string[]; onChange: (next: string[]) => void }) {
  return <div className="grid gap-2 md:grid-cols-2">{items.map((item) => {
    const checked = selected.includes(item);
    return <label key={item} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-2 ${checked ? 'border-primary bg-sky-50' : 'border-slate-200'}`}>
      <input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((value) => value !== item) : [...selected, item])} className="mt-0.5 h-5 w-5"/><span>{item}</span>
    </label>;
  })}</div>;
}

function ImagePicker({ label, slot, onPick, disabled }: { label: string; slot?: ImageSlot | undefined; onPick: (file: File) => void; disabled: boolean }) {
  return <div className="rounded-xl border border-slate-200 p-3">
    <p className={labelClass}>{label}</p>
    {slot ? <img src={slot.image.dataUrl} alt={`ตัวอย่าง${label}`} className="mt-2 max-h-56 w-full rounded-lg object-contain"/> : <div className="mt-2 flex h-32 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">ยังไม่ได้เลือกภาพ</div>}
    {slot && <UploadProgress slot={slot}/>}
    <label className={`mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-primary px-3 text-sm font-semibold text-primary ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {slot ? 'เปลี่ยนภาพ' : 'ถ่ายภาพ / เลือกภาพ'}
      <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onPick(file); event.target.value = ''; }}/>
    </label>
    {slot && <p className="mt-1 text-xs text-slate-500">ขนาดหลังย่อ {(slot.image.bytes / 1024).toFixed(0)} KB · ระบบตั้งชื่อไฟล์ใหม่อัตโนมัติ</p>}
  </div>;
}

function UploadProgress({ slot }: { slot: ImageSlot }) {
  if (!slot.progress && !slot.imageId) return null;
  const done = Boolean(slot.imageId);
  return <div className="mt-2" aria-live="polite">
    <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full transition-all ${done ? 'bg-success' : 'bg-primary'}`} style={{ width: `${done ? 100 : slot.progress}%` }}/></div>
    <p className="mt-1 text-xs text-slate-600">{done ? 'อัปโหลดแล้ว' : `กำลังอัปโหลด ${slot.progress}%`}</p>
  </div>;
}

export const STEPS: Array<{ title: string; fields: string[] }> = [
  { title: 'ข้อมูลการเยี่ยม', fields: ['visitDate', 'startTime', 'endTime', 'caregiverName', 'caregiverRelation', 'caregiverPhone'] },
  { title: 'สุขภาพแรกรับและสัญญาณชีพ', fields: ['weightKg', 'heightCm', 'vitals'] },
  { title: 'ประเมิน ADL', fields: ['adl'] },
  { title: 'สุขภาพจิต', fields: ['q2', 'q9', 'q8'] },
  { title: 'กิจกรรมการดูแล', fields: ['dailyCare', 'basicHealth', 'otherCare'] },
  { title: 'ภาพและลายมือชื่อ', fields: ['olderImageId', 'serviceImageId', 'signatureImageId'] },
  { title: 'ตรวจทานและส่ง', fields: ['urgentFlag', 'notes'] }
];

/** The step that shows a field; 'vitals.pulse' belongs to the step listing 'vitals'. */
export function stepOf(field: string): number {
  const index = STEPS.findIndex(({ fields }) => fields.some((name) => field === name || field.startsWith(`${name}.`)));
  return index === -1 ? STEPS.length - 1 : index;
}

function StepHeader({ step, reached, done, onJump }: { step: number; reached: number; done: Set<number>; onJump: (index: number) => void }) {
  const percent = Math.round((done.size / STEPS.length) * 100);
  return <div className="sticky top-28 z-30 -mx-4 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
    <div className="flex items-baseline justify-between gap-2"><p className="font-bold">ขั้นตอนที่ {step + 1}/{STEPS.length}: {STEPS[step]!.title}</p><p className="whitespace-nowrap text-sm text-slate-600">เสร็จแล้ว {percent}%</p></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="ความคืบหน้าของแบบบันทึก">
      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${percent}%` }}/>
    </div>
    <ol className="mt-3 flex gap-1">{STEPS.map(({ title }, index) => {
      const current = index === step;
      const complete = done.has(index) && !current;
      return <li key={title} className="flex-1">
        <button type="button" onClick={() => onJump(index)} disabled={index > reached} aria-current={current ? 'step' : undefined} aria-label={`ขั้นตอนที่ ${index + 1} ${title}`}
          className={`flex w-full flex-col items-center gap-1 rounded-lg py-1 text-xs disabled:cursor-not-allowed ${current ? 'font-bold text-primary' : 'text-slate-600'}`}>
          <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold ${current ? 'border-primary bg-primary text-white' : complete ? 'border-success bg-success text-white' : index <= reached ? 'border-primary bg-white text-primary' : 'border-slate-300 bg-white text-slate-400'}`}>{complete ? '✓' : index + 1}</span>
          <span className="hidden text-center leading-tight lg:block">{title}</span>
        </button>
      </li>;
    })}</ol>
  </div>;
}

interface SummaryItem { step: number; label: string; value: string; alert?: boolean }

function ReviewSummary({ items, images, onEdit }: { items: SummaryItem[]; images: Images; onEdit: (step: number) => void }) {
  return <Card>
    <h3 className="text-lg font-bold">สรุปก่อนส่ง</h3>
    <dl className="mt-3 divide-y divide-slate-100">{items.map((item) => <div key={item.label} className="flex items-start justify-between gap-3 py-2">
      <div><dt className="text-sm text-slate-500">{item.label}</dt><dd className={`font-semibold ${item.alert ? 'text-danger' : ''}`}>{item.value}</dd></div>
      <button type="button" onClick={() => onEdit(item.step)} className="shrink-0 text-sm text-primary underline">แก้ไข</button>
    </div>)}</dl>
    <div className="mt-3 grid grid-cols-3 gap-2">{([['OLDER', 'ผู้สูงอายุ'], ['SERVICE', 'กิจกรรม'], ['SIGNATURE', 'ลายมือชื่อ']] as const).map(([kind, label]) => <figure key={kind} className="rounded-lg border border-slate-200 p-1 text-center">
      {images[kind] ? <img src={images[kind]!.image.dataUrl} alt={label} className="h-20 w-full rounded object-contain"/> : <div className="flex h-20 items-center justify-center text-xs text-danger">ยังไม่มี</div>}
      <figcaption className="text-xs text-slate-600">{label}</figcaption>
    </figure>)}</div>
    <button type="button" onClick={() => onEdit(5)} className="mt-2 text-sm text-primary underline">แก้ไขภาพหรือลายมือชื่อ</button>
  </Card>;
}

export function VisitRecordForm() {
  const { id: visitId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ['visit-context', visitId], queryFn: () => post<VisitContext>('/visit-context', { visitId }) });
  const [form, setForm] = useState<FormState>(initialState);
  const [images, setImages] = useState<Images>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [changingDate, setChangingDate] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setAt = <K extends 'q2' | 'q9' | 'q8'>(key: K, index: number, value: FormState[K][number]) =>
    setForm((current) => ({ ...current, [key]: current[key].map((item, position) => (position === index ? value : item)) }));

  // Live results, from the same shared functions the server uses.
  const weight = toNumber(form.weightKg);
  const height = toNumber(form.heightCm);
  const bmi = weight && height && weight > 0 && height > 0 ? calculateBmi(weight, height) : null;
  const adlComplete = ADL_ITEMS.every(({ key }) => typeof form.adl[key] === 'number');
  const adlTotal = adlComplete ? calculateAdlTotal(form.adl as AdlItems) : null;
  const screenPositive = form.q2.some((answer) => answer === true);
  const screenDone = form.q2.every((answer) => answer !== null);
  const q9Complete = form.q9.every((answer) => answer !== null);
  const q9Score = screenPositive && q9Complete ? sum(form.q9 as number[]) : null;
  const show8q = q9Score !== null && needsSuicideAssessment(form.q9 as number[]);
  const q8Complete = form.q8.every((answer) => answer !== null) && (form.q8[2] !== true || form.canControl !== null);
  const q8Score = show8q && q8Complete ? scoreQ8(form.q8 as boolean[], form.canControl ?? undefined) : null;
  const riskVisible = (show8q && form.q8.some(Boolean)) || (form.q9[8] ?? 0) > 0;

  const payload = useMemo(() => {
    const bp = parseBloodPressure(form.bloodPressure);
    return {
      visitId, submissionId: crypto.randomUUID(), visitDate: form.visitDate, startTime: form.startTime, endTime: form.endTime,
      caregiverName: form.caregiverName.trim(), caregiverRelation: form.caregiverRelation, caregiverPhone: form.caregiverPhone,
      weightKg: toNumber(form.weightKg), heightCm: toNumber(form.heightCm),
      vitals: { temperature: toNumber(form.temperature), pulse: toNumber(form.pulse), respiration: toNumber(form.respiration), systolic: bp?.systolic, diastolic: bp?.diastolic },
      adl: form.adl, q2: form.q2,
      q9: screenPositive ? form.q9 : undefined,
      q8: show8q ? { answers: form.q8, canControl: form.q8[2] ? form.canControl ?? undefined : undefined } : undefined,
      dailyCare: form.dailyCare, basicHealth: form.basicHealth, otherCare: form.otherCare,
      olderImageId: images.OLDER ? 'pending' : '', serviceImageId: images.SERVICE ? 'pending' : '', signatureImageId: images.SIGNATURE ? 'pending' : '',
      urgentFlag: form.urgent ?? undefined, notes: form.notes
    };
  }, [form, images, visitId, screenPositive, show8q]);

  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [done, setDone] = useState<Set<number>>(() => new Set());

  /** Every problem in the whole form, keyed by field. */
  const findErrors = (): Record<string, string> => {
    const result = visitRecordSubmitSchema.safeParse(payload);
    const found: Record<string, string> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = fieldOf(issue.path);
        found[field] ??= MESSAGES[issue.message] ?? (issue.code === 'invalid_type' ? 'กรุณากรอก/เลือก' : field === 'caregiverPhone' ? 'ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0' : 'ค่าไม่ถูกต้อง');
      }
    }
    if (form.bloodPressure.trim() && !parseBloodPressure(form.bloodPressure)) found['vitals.systolic'] = 'รูปแบบ เช่น 110/86';
    if (form.visitDate > todayInBangkok()) found.visitDate = 'วันที่เยี่ยมต้องไม่เกินวันนี้';
    return found;
  };

  const showProblems = (found: Record<string, string>) => {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (!first) return;
    setTimeout(() => document.querySelector(`[data-field="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    const names = [...new Set(Object.keys(found).map((field) => FIELD_LABELS[field] ?? field))];
    void Swal.fire({ icon: 'warning', title: 'ข้อมูลยังไม่ครบหรือไม่ถูกต้อง', html: `กรุณาตรวจสอบ: <b>${names.slice(0, 8).join(', ')}${names.length > 8 ? ' และอื่น ๆ' : ''}</b>`, confirmButtonText: 'ตกลง', confirmButtonColor: '#0284C7' });
  };

  const errorsIn = (found: Record<string, string>, index: number) => Object.fromEntries(Object.entries(found).filter(([field]) => stepOf(field) === index));

  const goTo = (index: number) => {
    setStep(index);
    setReached((current) => Math.max(current, index));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Moving forward checks only the current step; going back never blocks. */
  const next = () => {
    const mine = errorsIn(findErrors(), step);
    if (Object.keys(mine).length) { showProblems(mine); return; }
    setErrors({});
    setDone((current) => new Set(current).add(step));
    goTo(step + 1);
  };
  const back = () => { setErrors({}); goTo(Math.max(0, step - 1)); };
  const jump = (index: number) => { if (index <= reached) { setErrors({}); goTo(index); } };

  /** Before sending, check everything and open the first step that still has a problem. */
  const validate = (): boolean => {
    const found = findErrors();
    const steps = Object.keys(found).map(stepOf);
    if (!steps.length) return true;
    const target = Math.min(...steps);
    goTo(target);
    showProblems(errorsIn(found, target));
    return false;
  };

  const summaryItems: SummaryItem[] = [
    { step: 0, label: 'วันที่และเวลาเยี่ยม', value: `${formatThaiDate(form.visitDate)} ${form.startTime || '–'}–${form.endTime || '–'} น.` },
    { step: 0, label: 'ผู้ดูแล', value: form.caregiverName ? `${form.caregiverName} (${form.caregiverRelation || '–'}) ${form.caregiverPhone}` : '–' },
    { step: 1, label: 'ดัชนีมวลกาย', value: bmi === null ? '–' : `${bmi} (${interpretBmi(bmi)})` },
    { step: 1, label: 'สัญญาณชีพ', value: `T ${form.temperature || '–'} · P ${form.pulse || '–'} · R ${form.respiration || '–'} · BP ${form.bloodPressure || '–'}` },
    { step: 2, label: 'คะแนน ADL', value: adlTotal === null ? '–' : `${adlTotal}/20` },
    { step: 3, label: 'สุขภาพจิต', value: !screenDone ? '–' : !screenPositive ? '2Q ปกติ' : `9Q ${q9Score ?? '–'}${q9Score === null ? '' : ` (${interpretQ9(q9Score)})`}${show8q ? ` · 8Q ${q8Score ?? '–'}${q8Score === null ? '' : ` (${interpretQ8(q8Score)})`}` : ''}`, alert: riskVisible },
    { step: 4, label: 'กิจกรรมการดูแล', value: `${form.dailyCare.length + form.basicHealth.length + form.otherCare.length} รายการ` }
  ];

  const pickImage = async (kind: ImageKind, file: File) => {
    try {
      const image = await compressImage(file);
      setImages((current) => ({ ...current, [kind]: { image, progress: 0 } }));
    } catch (error) {
      void Swal.fire({ icon: 'error', title: 'ใช้ภาพนี้ไม่ได้', text: error instanceof Error ? error.message : 'ลองเลือกภาพอื่น', confirmButtonColor: '#0284C7' });
    }
  };

  /** Uploads what is not uploaded yet; a retry after a failure skips the images already stored. */
  const uploadImages = async (): Promise<Record<ImageKind, string>> => {
    const ids: Partial<Record<ImageKind, string>> = {};
    for (const kind of ['OLDER', 'SERVICE', 'SIGNATURE'] as const) {
      const slot = images[kind]!;
      if (slot.imageId) { ids[kind] = slot.imageId; continue; }
      const { imageId } = await postWithProgress<{ imageId: string }>('/visit-images', { visitId, kind, mimeType: slot.image.mimeType, base64: slot.image.base64 },
        (progress) => setImages((current) => ({ ...current, [kind]: { ...current[kind]!, progress } })));
      ids[kind] = imageId;
      setImages((current) => ({ ...current, [kind]: { ...current[kind]!, progress: 100, imageId } }));
    }
    return ids as Record<ImageKind, string>;
  };

  const submit = async () => {
    if (!validate()) return;
    const confirmed = await Swal.fire({
      icon: 'question', title: 'ส่งบันทึกการเยี่ยม?', text: 'เมื่อส่งแล้วจะแก้ไขไม่ได้ จนกว่า CM จะส่งคืน', showCancelButton: true,
      confirmButtonText: 'ส่งบันทึก', cancelButtonText: 'ตรวจทานอีกครั้ง', confirmButtonColor: '#0284C7', reverseButtons: true
    });
    if (!confirmed.isConfirmed) return;
    setBusy(true);
    void Swal.fire({ title: 'กำลังอัปโหลดภาพและบันทึก…', text: 'ดูความคืบหน้าของแต่ละภาพได้ในฟอร์ม', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const ids = await uploadImages();
      const result = await post<{ visitNumber: number }>('/visit-records', { ...payload, olderImageId: ids.OLDER, serviceImageId: ids.SERVICE, signatureImageId: ids.SIGNATURE });
      await Promise.all(['visits', 'dashboard', 'reviews', 'alerts'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      await Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', text: `บันทึกการเยี่ยมครั้งที่ ${result.visitNumber} แล้ว รอ CM ตรวจทาน`, confirmButtonText: 'กลับไปหน้างานเยี่ยม', confirmButtonColor: '#0284C7' });
      navigate('/visits');
    } catch (error) {
      await Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: `${error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'} — ภาพที่อัปโหลดแล้วจะไม่ต้องอัปโหลดซ้ำ กดส่งอีกครั้งได้`, confirmButtonText: 'ตกลง', confirmButtonColor: '#0284C7' });
    } finally {
      setBusy(false);
    }
  };

  if (context.isLoading) return <Loading/>;
  if (context.error) return <ErrorState message={context.error.message}/>;
  const info = context.data!;
  const e = errors;

  return <div className="mx-auto max-w-4xl space-y-4 pb-32 md:pb-24">
    <div><h2 className="text-2xl font-bold">บันทึกการเยี่ยมบ้าน</h2><p className="text-slate-600">กรอกทีละขั้นตอน ช่องที่มี * ต้องกรอก</p></div>

    <Card className="border-sky-200 bg-sky-50">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2"><p className="text-sm text-slate-600">ผู้รับบริการ</p><p className="text-xl font-bold">{info.patientName}</p><p className="text-sm text-slate-600">{info.visitType || 'เยี่ยมตาม Care Plan'}</p></div>
        <Result label="ครั้งที่เยี่ยม" value={`ครั้งที่ ${info.visitNumber}`} tone="success"/>
        <Result label="ผู้เยี่ยม" value={info.visitorName}/>
      </div>
    </Card>

    <StepHeader step={step} reached={reached} done={done} onJump={jump}/>

    {step === 0 && <>
      <Section number={0} title="ข้อมูลการเยี่ยม">
        <div className="grid gap-3 md:grid-cols-3">
          <div data-field="visitDate"><p className={labelClass}>วันที่เยี่ยม *</p>
            <div className="mt-1 flex min-h-11 items-center gap-2"><span className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold">{formatThaiDate(form.visitDate)}</span>
              <button type="button" onClick={() => setChangingDate((value) => !value)} className="text-sm text-primary underline">เปลี่ยนวันที่</button></div>
            {changingDate && <input type="date" max={todayInBangkok()} value={form.visitDate} onChange={(event) => event.target.value && set('visitDate', event.target.value)} className={fieldClass}/>}
            <FieldError message={e.visitDate}/></div>
          <label className={labelClass} data-field="startTime">เวลาเยี่ยม *<input type="time" value={form.startTime} onChange={(event) => set('startTime', event.target.value)} className={fieldClass}/><FieldError message={e.startTime}/></label>
          <label className={labelClass} data-field="endTime">เวลาสิ้นสุด *<div className="flex gap-2"><input type="time" value={form.endTime} onChange={(event) => set('endTime', event.target.value)} className={fieldClass}/><button type="button" onClick={() => set('endTime', nowTime())} className="mt-1 whitespace-nowrap rounded-lg border border-slate-300 px-3 text-sm">ตอนนี้</button></div><FieldError message={e.endTime}/></label>
          <label className={labelClass} data-field="caregiverName">ชื่อผู้ดูแล *<span className={hintClass}>ญาติหรือผู้ดูแลหลักที่บ้าน</span><input value={form.caregiverName} onChange={(event) => set('caregiverName', event.target.value)} className={fieldClass}/><FieldError message={e.caregiverName}/></label>
          <label className={labelClass} data-field="caregiverRelation">ความสัมพันธ์ *<span className={hintClass}>กับผู้สูงอายุ</span><select value={form.caregiverRelation} onChange={(event) => set('caregiverRelation', event.target.value)} className={fieldClass}><option value="">เลือก</option>{RELATIONS.map((relation) => <option key={relation}>{relation}</option>)}</select><FieldError message={e.caregiverRelation}/></label>
          <label className={labelClass} data-field="caregiverPhone">เบอร์ติดต่อ *<span className={hintClass}>ตัวเลขเท่านั้น 9–10 หลัก</span><input inputMode="numeric" maxLength={10} value={form.caregiverPhone} onChange={(event) => set('caregiverPhone', event.target.value.replace(/\D/g, ''))} placeholder="0812345678" className={fieldClass}/><FieldError message={e.caregiverPhone}/></label>
        </div>
      </Section>
    </>}
    {step === 1 && <>
      <Section number={1} title="การประเมินสุขภาพแรกรับ">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass} data-field="weightKg">น้ำหนัก (กก.) *<input type="number" inputMode="decimal" step="0.1" value={form.weightKg} onChange={(event) => set('weightKg', event.target.value)} className={fieldClass}/><FieldError message={e.weightKg}/></label>
          <label className={labelClass} data-field="heightCm">ส่วนสูง (ซม.) *<input type="number" inputMode="decimal" step="0.1" value={form.heightCm} onChange={(event) => set('heightCm', event.target.value)} className={fieldClass}/><FieldError message={e.heightCm}/></label>
          <Result label="ดัชนีมวลกาย (กก./ม²)" value={bmi === null ? '–' : String(bmi)}/>
          <Result label="แปลผล" value={bmi === null ? '–' : interpretBmi(bmi)} tone={bmi === null ? 'neutral' : interpretBmi(bmi) === 'ปกติ' ? 'success' : 'warning'}/>
        </div>
      </Section>

      <Section number={2} title="การประเมินสัญญาณชีพ">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass} data-field="vitals.temperature">อุณหภูมิ (°C) *<span className={hintClass}>ปกติ 35.5–37.4</span><input type="number" inputMode="decimal" step="0.1" value={form.temperature} onChange={(event) => set('temperature', event.target.value)} className={fieldClass}/><FieldError message={e['vitals.temperature']}/></label>
          <label className={labelClass} data-field="vitals.pulse">ชีพจร (ครั้ง/นาที) *<span className={hintClass}>ปกติ 60–100</span><input type="number" inputMode="numeric" value={form.pulse} onChange={(event) => set('pulse', event.target.value)} className={fieldClass}/><FieldError message={e['vitals.pulse']}/></label>
          <label className={labelClass} data-field="vitals.respiration">การหายใจ (ครั้ง/นาที) *<span className={hintClass}>ปกติ 12–20</span><input type="number" inputMode="numeric" value={form.respiration} onChange={(event) => set('respiration', event.target.value)} className={fieldClass}/><FieldError message={e['vitals.respiration']}/></label>
          <label className={labelClass} data-field="vitals.systolic">ความดันโลหิต (mmHg) *<span className={hintClass}>เช่น 110/86</span><input inputMode="numeric" value={form.bloodPressure} onChange={(event) => set('bloodPressure', event.target.value.replace(/[^\d/]/g, ''))} placeholder="110/86" className={fieldClass}/><FieldError message={e['vitals.systolic'] ?? e['vitals.diastolic']}/></label>
        </div>
      </Section>

    </>}
    {step === 2 && <>
      <Section number={3} title="การประเมิน ADL (Barthel 10 ข้อ)" hint="เลือกระดับที่ผู้สูงอายุทำได้จริงในปัจจุบัน">
        <div className="space-y-3" data-field="adl">{ADL_ITEMS.map(({ key, title, hint, levels }) => <fieldset key={key} className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 font-semibold">{title}{hint && <span className="ml-1 text-sm font-normal text-slate-500">({hint})</span>}</legend>
          <div className="space-y-2">{levels.map((text, score) => <label key={score} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-2 ${form.adl[key] === score ? 'border-primary bg-sky-50' : 'border-slate-200'}`}>
            <input type="radio" name={`adl-${key}`} checked={form.adl[key] === score} onChange={() => set('adl', { ...form.adl, [key]: score })} className="mt-1 h-5 w-5"/>
            <span className="flex-1">{text}</span><span className="whitespace-nowrap font-bold text-primary">{score} คะแนน</span>
          </label>)}</div>
        </fieldset>)}</div>
        <FieldError message={e.adl}/>
        <div className="sticky bottom-20 mt-3 flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 shadow-sm md:bottom-4"><span className="font-bold">คะแนน ADL รวม <span className="text-sm font-normal text-slate-600">(ตอบแล้ว {ADL_ITEMS.filter(({ key }) => typeof form.adl[key] === 'number').length}/10)</span></span><span className="text-2xl font-bold text-primary">{adlTotal ?? '–'}/20</span></div>
      </Section>

    </>}
    {step === 3 && <>
      <Section number={4} title="การประเมินสุขภาพจิต" hint="คัดกรองโรคซึมเศร้าด้วย 2 คำถาม (2Q) ถ้าตอบ “มี” ข้อใดข้อหนึ่ง ให้ประเมินต่อด้วย 9Q">
        <div className="space-y-3" data-field="q2">{Q2_QUESTIONS.map((question, index) => <div key={question}><p className="mb-2">{index + 1}. {question}</p><YesNo name={`q2-${index}`} value={form.q2[index] ?? null} onChange={(value) => setAt('q2', index, value)}/></div>)}</div>
        <FieldError message={e.q2}/>
        {screenDone && !screenPositive && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-800">ผลคัดกรอง 2Q ปกติ ไม่ต้องประเมิน 9Q</p>}

        {screenPositive && <div className="mt-4 rounded-xl border border-amber-200 p-3" data-field="q9">
          <p className="font-bold">แบบประเมินโรคซึมเศร้า 9 คำถาม (9Q)</p>
          <p className="text-sm text-slate-600">ในช่วง 2 สัปดาห์ที่ผ่านมารวมทั้งวันนี้ ท่านมีอาการเหล่านี้บ่อยแค่ไหน</p>
          <div className="mt-3 space-y-3">{Q9_QUESTIONS.map((question, index) => <div key={question}><p className="mb-1">{index + 1}. {question}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Q9_FREQUENCIES.map((label, score) => <label key={label} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 text-sm ${form.q9[index] === score ? 'border-primary bg-sky-50 font-semibold' : 'border-slate-300'}`}>
              <input type="radio" name={`q9-${index}`} checked={form.q9[index] === score} onChange={() => setAt('q9', index, score)} className="h-4 w-4"/>{label} ({score})
            </label>)}</div></div>)}</div>
          <FieldError message={e.q9}/>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><Result label="คะแนน 9Q" value={q9Score === null ? `– (ตอบแล้ว ${form.q9.filter((answer) => answer !== null).length}/9)` : String(q9Score)}/><Result label="แปลผล" value={q9Score === null ? '–' : interpretQ9(q9Score)} tone={q9Score === null ? 'neutral' : q9Score <= 6 ? 'success' : q9Score <= 12 ? 'warning' : 'danger'}/></div>
          {q9Score !== null && !show8q && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-800">คะแนน 9Q น้อยกว่า 7 ไม่ต้องประเมิน 8Q</p>}
        </div>}

        {show8q && <div className="mt-4 rounded-xl border border-red-200 p-3" data-field="q8">
          <p className="font-bold">แบบประเมินการฆ่าตัวตาย (8Q)</p>
          <div className="mt-3 space-y-3">{Q8_QUESTIONS.map((question, index) => <div key={question.text}>
            {'period' in question && <p className="mb-1 text-sm font-semibold text-slate-600">{question.period}</p>}
            <p className="mb-1">{index + 1}. {question.text} <span className="text-sm text-slate-500">(มี = {question.score})</span></p>
            <YesNo name={`q8-${index}`} value={form.q8[index] ?? null} onChange={(value) => setAt('q8', index, value)}/>
            {index === 2 && form.q8[2] === true && <div className="ml-4 mt-2 border-l-4 border-red-200 pl-3" data-field="q8.canControl"><p className="mb-1 text-sm">{Q8_FOLLOW_UP.text} <span className="text-slate-500">(ไม่ได้ = {Q8_FOLLOW_UP.scoreIfCannot})</span></p>
              <YesNo name="q8-control" value={form.canControl === null ? null : !form.canControl} onChange={(cannot) => set('canControl', !cannot)} yes="ไม่ได้" no="ได้"/><FieldError message={e['q8.canControl']}/></div>}
          </div>)}</div>
          <FieldError message={e.q8}/>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><Result label="คะแนน 8Q" value={q8Score === null ? '–' : String(q8Score)}/><Result label="แปลผล" value={q8Score === null ? '–' : interpretQ8(q8Score)} tone={q8Score === null ? 'neutral' : q8Score === 0 ? 'success' : q8Score <= 8 ? 'warning' : 'danger'}/></div>
        </div>}

        {riskVisible && <div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 font-semibold text-red-800">พบความเสี่ยงด้านสุขภาพจิต ระบบจะแจ้ง CM เมื่อส่งบันทึก หากมีความเสี่ยงทันที อย่าปล่อยผู้สูงอายุอยู่ลำพัง โทรสายด่วนสุขภาพจิต 1323 หรือฉุกเฉิน 1669</div>}
      </Section>

    </>}
    {step === 4 && <>
      <Section number={5} title="กิจกรรมการดูแลด้านการช่วยเหลือประจำวัน" hint="เลือกได้หลายรายการ"><Checklist items={DAILY_CARE_ACTIVITIES} selected={form.dailyCare} onChange={(next) => set('dailyCare', next)}/></Section>
      <Section number={6} title="กิจกรรมการดูแลด้านสุขภาพพื้นฐาน" hint="เลือกได้หลายรายการ"><Checklist items={BASIC_HEALTH_ACTIVITIES} selected={form.basicHealth} onChange={(next) => set('basicHealth', next)}/></Section>
      <Section number={7} title="กิจกรรมการดูแลด้านอื่น ๆ" hint="เลือกได้หลายรายการ"><Checklist items={OTHER_CARE_ACTIVITIES} selected={form.otherCare} onChange={(next) => set('otherCare', next)}/></Section>
    </>}
    {step === 5 && <>
      <Section number={8} title="ภาพประกอบ" hint="ระบบย่อภาพก่อนอัปโหลด ข้อมูล DEMO เท่านั้น ห้ามใช้ภาพบุคคลจริง">
        <div className="grid gap-3 md:grid-cols-2">
          <div data-field="olderImageId"><ImagePicker label="ภาพผู้สูงอายุ *" slot={images.OLDER} disabled={busy} onPick={(file) => pickImage('OLDER', file)}/><FieldError message={e.olderImageId && 'กรุณาเลือกภาพ'}/></div>
          <div data-field="serviceImageId"><ImagePicker label="ภาพกิจกรรมการดูแล *" slot={images.SERVICE} disabled={busy} onPick={(file) => pickImage('SERVICE', file)}/><FieldError message={e.serviceImageId && 'กรุณาเลือกภาพ'}/></div>
        </div>
      </Section>

      <Section number={9} title="ลายมือชื่อ *" hint="ผู้สูงอายุหรือผู้ดูแลลงชื่อรับบริการ">
        <div data-field="signatureImageId">
          {images.SIGNATURE
            ? <div><img src={images.SIGNATURE.image.dataUrl} alt="ลายมือชื่อที่เซ็นไว้" className="h-44 w-full rounded-xl border border-slate-200 bg-white object-contain"/>
                <button type="button" disabled={busy || Boolean(images.SIGNATURE.imageId)} onClick={() => setImages((current) => { const next = { ...current }; delete next.SIGNATURE; return next; })} className="mt-2 min-h-10 rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-50 disabled:opacity-50">เซ็นใหม่</button></div>
            : <SignaturePad disabled={busy} onChange={(image) => setImages((current) => { const next = { ...current }; if (image) next.SIGNATURE = { image, progress: 0 }; else delete next.SIGNATURE; return next; })}/>}
          {images.SIGNATURE && <UploadProgress slot={images.SIGNATURE}/>}
          <FieldError message={e.signatureImageId && 'กรุณาลงลายมือชื่อ'}/>
        </div>
      </Section>
    </>}
    {step === 6 && <>
      <Card>
        <div data-field="urgentFlag"><p className="font-bold">เรื่องเร่งด่วน *</p>
          <div className="mt-2"><YesNo name="urgent" value={form.urgent} onChange={(value) => set('urgent', value)} yes="มีเรื่องที่ CM ควรรู้โดยเร็ว" no="ไม่มีเรื่องเร่งด่วน"/></div>
          <FieldError message={e.urgentFlag}/>
          <p className="mt-2 text-sm text-slate-500">เช่น มีไข้ ซึมลง กินไม่ได้ หกล้ม มีแผลใหม่ ญาติดูแลต่อไม่ได้ — ระบบจะแจ้งเตือน CM ทันทีที่ส่ง</p>
          <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-800">ภาวะฉุกเฉิน เช่น หมดสติ หายใจลำบาก เจ็บหน้าอก ชัก ให้โทร 1669 ทันที ไม่ต้องรอระบบ</p>
        </div>
        <label className={`${labelClass} mt-4`}>บันทึกเพิ่มเติม<textarea value={form.notes} maxLength={1500} onChange={(event) => set('notes', event.target.value)} className={fieldClass}/></label>
      </Card>
      <ReviewSummary items={summaryItems} images={images} onEdit={jump}/>
    </>}

    <nav aria-label="เลื่อนขั้นตอน" className="fixed inset-x-0 bottom-16 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-64">
      <div className="mx-auto flex max-w-4xl gap-3">
        <button type="button" onClick={back} disabled={step === 0 || busy} className="min-h-12 flex-1 rounded-xl border border-slate-300 font-semibold disabled:opacity-40">ย้อนกลับ</button>
        {step < STEPS.length - 1
          ? <button type="button" onClick={next} className="min-h-12 flex-[2] rounded-xl bg-primary px-2 font-bold text-white hover:bg-sky-700">ถัดไป<span className="hidden sm:inline">: {STEPS[step + 1]!.title}</span></button>
          : <button type="button" onClick={submit} disabled={busy} className="min-h-12 flex-[2] rounded-xl bg-success font-bold text-white disabled:opacity-60">{busy ? 'กำลังส่ง…' : 'ส่งบันทึกการเยี่ยม'}</button>}
      </div>
    </nav>
  </div>;
}
