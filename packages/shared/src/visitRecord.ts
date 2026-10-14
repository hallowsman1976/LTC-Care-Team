import { z } from 'zod';
import { adlAssessmentItemsSchema } from './adl';

// The full home-visit record (sheet Visit_Records). Scores are computed here so the web form's
// live totals and the stored values come from the same code; GAS recomputes them on submit and
// never trusts totals sent by the client.

export const RELATIONS = ['พ่อ', 'แม่', 'บุตร', 'พี่', 'น้อง', 'หลาน', 'ญาติ'] as const;

export const DAILY_CARE_ACTIVITIES = [
  'การเปลี่ยนผ้าอ้อม/แผ่นรองซับ',
  'การพลิกตะแคงตัว',
  'การจัดท่านอนป้องกันแผลกดทับ/ป้องกันเท้าตก',
  'การเคลื่อนย้ายผู้สูงอายุบนเตียง/ที่นอน รวมถึงการช่วยเคลื่อนย้ายจากจุดหนึ่งไปยังอีกจุดหนึ่ง'
] as const;

export const BASIC_HEALTH_ACTIVITIES = [
  'การประเมินภาวะซึมเศร้า',
  'การประเมินสัญญาณชีพ (วัดความดันโลหิต อุณหภูมิ หายใจ ชีพจร)',
  'การทำแผล',
  'การดูแลสายสวนต่าง ๆ ให้สะอาดและอยู่ในตำแหน่งที่เหมาะสม',
  'การนวดผ่อนคลายกล้ามเนื้อและกระตุ้นระบบไหลเวียน',
  'การบริหารข้อและกล้ามเนื้อ',
  'การฝึกทรงตัว/การฝึกเดิน',
  'สมาธิบำบัด',
  'การฝึกหายใจ'
] as const;

export const OTHER_CARE_ACTIVITIES = [
  'ดูแลสถานที่อยู่อาศัยของผู้สูงอายุให้สะอาด ปลอดภัย และมีอากาศถ่ายเทได้สะดวก',
  'การให้คำปรึกษาด้านสุขภาพแก่ผู้สูงอายุ',
  'การให้คำปรึกษาด้านสุขภาพแก่ครอบครัว/ผู้ดูแลผู้สูงอายุ',
  'การอ่านหนังสือ/บทสวดมนต์ หรือเอกสารอื่น ๆ ที่เป็นประโยชน์ให้ผู้สูงอายุฟัง',
  'การช่วยพาไปพบแพทย์/บุคลากรสาธารณสุขตามนัดหรือตามความจำเป็น โดยการบริการหรือจัดพาหนะรับส่งผู้สูงอายุ',
  'ช่วยบุคลากรสาธารณสุขในการทำหัตถการต่าง ๆ ในผู้สูงอายุ',
  'ประสานการเบิกจ่ายวัสดุอุปกรณ์การแพทย์จาก รพ./รพ.สต. ให้ผู้สูงอายุ',
  'ประสานบุคลากรสาธารณสุขเพื่อให้การช่วยเหลือกรณีฉุกเฉินเร่งด่วนต่าง ๆ'
] as const;

export const Q2_QUESTIONS = [
  'ใน 2 สัปดาห์ที่ผ่านมา รวมวันนี้ ท่านรู้สึก หดหู่ เศร้า หรือท้อแท้สิ้นหวัง หรือไม่',
  'ใน 2 สัปดาห์ที่ผ่านมา รวมวันนี้ ท่านรู้สึก เบื่อ ทำอะไรก็ไม่เพลิดเพลิน หรือไม่'
] as const;

export const Q9_QUESTIONS = [
  'เบื่อ ไม่สนใจอยากทำอะไร',
  'ไม่สบายใจ ซึมเศร้า ท้อแท้',
  'หลับยากหรือหลับ ๆ ตื่น ๆ หรือหลับมากไป',
  'เหนื่อยง่ายหรือไม่ค่อยมีแรง',
  'เบื่ออาหารหรือกินมากเกินไป',
  'รู้สึกไม่ดีกับตัวเอง คิดว่าตัวเองล้มเหลวหรือครอบครัวผิดหวัง',
  'สมาธิไม่ดี เวลาทำอะไร เช่น ดูโทรทัศน์ ฟังวิทยุ หรือทำงานที่ต้องใช้ความตั้งใจ',
  'พูดช้า ทำอะไรช้าลงจนคนอื่นสังเกตเห็นได้ หรือกระสับกระส่ายไม่สามารถอยู่นิ่งได้เหมือนที่เคยเป็น',
  'คิดทำร้ายตนเอง หรือคิดว่าถ้าตายไปคงจะดี'
] as const;

export const Q9_FREQUENCIES = ['ไม่มีเลย', 'เป็นบางวัน', 'เป็นบ่อย', 'เป็นทุกวัน'] as const;

/** 8Q (กรมสุขภาพจิต): the score a "มี" answer adds. Item 3 has a follow-up worth 8 when "ไม่ได้". */
export const Q8_QUESTIONS = [
  { text: 'คิดอยากตาย หรือคิดว่าตายไปจะดีกว่า', score: 1 },
  { text: 'อยากทำร้ายตัวเอง หรือทำให้ตัวเองบาดเจ็บ', score: 2 },
  { text: 'คิดเกี่ยวกับการฆ่าตัวตาย', score: 6, period: 'ในช่วง 1 เดือนที่ผ่านมารวมวันนี้' },
  { text: 'มีแผนการที่จะฆ่าตัวตาย', score: 8 },
  { text: 'ได้เตรียมการที่จะทำร้ายตนเองหรือเตรียมการจะฆ่าตัวตายโดยตั้งใจว่าจะให้ตายจริง ๆ', score: 9 },
  { text: 'ได้ทำให้ตนเองบาดเจ็บแต่ไม่ตั้งใจที่จะทำให้เสียชีวิต', score: 4 },
  { text: 'ได้พยายามฆ่าตัวตายโดยคาดหวัง/ตั้งใจที่จะให้ตาย', score: 10 },
  { text: 'ตลอดชีวิตที่ผ่านมา ท่านเคยพยายามฆ่าตัวตาย', score: 4 }
] as const;
export const Q8_FOLLOW_UP = { text: 'ท่านสามารถควบคุมความอยากฆ่าตัวตายที่ท่านคิดอยู่นั้นได้หรือไม่ หรือบอกได้ไหมว่าคงจะไม่ทำตามความคิดนั้นในขณะนี้', scoreIfCannot: 8 } as const;

export const IMAGE_KINDS = ['OLDER', 'SERVICE', 'SIGNATURE'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'รูปแบบเวลา HH:MM');
const yesNo = z.boolean();
const bounded = (min: number, max: number) => z.number().finite().min(min).max(max);

export const visitRecordSubmitSchema = z.object({
  visitId: z.string().trim().min(1).max(80),
  submissionId: z.string().uuid(),
  visitDate: z.string().date(),
  startTime: time,
  endTime: time,
  caregiverName: z.string().trim().min(2).max(120),
  caregiverRelation: z.enum(RELATIONS),
  caregiverPhone: z.string().regex(/^0\d{8,9}$/, 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0'),
  weightKg: bounded(10, 300),
  heightCm: bounded(50, 250),
  vitals: z.object({
    temperature: bounded(30, 45),
    pulse: z.number().int().min(20).max(250),
    respiration: z.number().int().min(5).max(80),
    systolic: z.number().int().min(50).max(300),
    diastolic: z.number().int().min(20).max(200)
  }),
  adl: adlAssessmentItemsSchema,
  q2: z.tuple([yesNo, yesNo]),
  q9: z.array(z.number().int().min(0).max(3)).length(9).optional(),
  q8: z.object({ answers: z.array(yesNo).length(8), canControl: yesNo.optional() }).optional(),
  dailyCare: z.array(z.enum(DAILY_CARE_ACTIVITIES)).max(DAILY_CARE_ACTIVITIES.length),
  basicHealth: z.array(z.enum(BASIC_HEALTH_ACTIVITIES)).max(BASIC_HEALTH_ACTIVITIES.length),
  otherCare: z.array(z.enum(OTHER_CARE_ACTIVITIES)).max(OTHER_CARE_ACTIVITIES.length),
  olderImageId: z.string().trim().min(1).max(80),
  serviceImageId: z.string().trim().min(1).max(80),
  signatureImageId: z.string().trim().min(1).max(80),
  urgentFlag: z.boolean(),
  notes: z.string().max(1500)
}).superRefine((record, context) => {
  if (record.endTime <= record.startTime) context.addIssue({ code: 'custom', path: ['endTime'], message: 'END_BEFORE_START' });
  if (record.vitals.diastolic >= record.vitals.systolic) context.addIssue({ code: 'custom', path: ['vitals', 'diastolic'], message: 'DIASTOLIC_NOT_BELOW_SYSTOLIC' });
  const screenPositive = record.q2.some(Boolean);
  if (screenPositive !== Boolean(record.q9)) context.addIssue({ code: 'custom', path: ['q9'], message: screenPositive ? 'Q9_REQUIRED' : 'Q9_NOT_EXPECTED' });
  const needs8q = Boolean(record.q9) && needsSuicideAssessment(record.q9!);
  if (needs8q !== Boolean(record.q8)) context.addIssue({ code: 'custom', path: ['q8'], message: needs8q ? 'Q8_REQUIRED' : 'Q8_NOT_EXPECTED' });
  if (record.q8?.answers[2] && record.q8.canControl === undefined) context.addIssue({ code: 'custom', path: ['q8', 'canControl'], message: 'Q8_FOLLOW_UP_REQUIRED' });
});
export type VisitRecordInput = z.infer<typeof visitRecordSubmitSchema>;

export const visitImageUploadSchema = z.object({
  visitId: z.string().trim().min(1).max(80),
  kind: z.enum(IMAGE_KINDS),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  // 3 MB is plenty for a resized photo or a signature; base64 expands 3 bytes into 4 characters.
  base64: z.string().min(4).max(4 * 1024 * 1024)
});
export type VisitImageUploadInput = z.infer<typeof visitImageUploadSchema>;

export const visitContextSchema = z.object({ visitId: z.string().trim().min(1).max(80) });

export interface VisitContext {
  visitId: string;
  patientName: string;
  visitType: string;
  visitDateTime: string;
  visitNumber: number;
  visitorName: string;
}

export function calculateBmi(weightKg: number, heightCm: number): number {
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

/** Asia-Pacific BMI cut-offs used in Thai practice. */
export function interpretBmi(bmi: number): string {
  if (bmi < 18.5) return 'น้ำหนักน้อยกว่าเกณฑ์';
  if (bmi < 23) return 'ปกติ';
  if (bmi < 25) return 'น้ำหนักเกิน';
  if (bmi < 30) return 'อ้วนระดับ 1';
  return 'อ้วนระดับ 2';
}

export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function interpretQ9(score: number): string {
  if (score <= 6) return 'ไม่มีภาวะซึมเศร้า';
  if (score <= 12) return 'มีภาวะซึมเศร้าระดับน้อย';
  if (score <= 18) return 'มีภาวะซึมเศร้าระดับปานกลาง';
  return 'มีภาวะซึมเศร้าระดับรุนแรง';
}

export function needsSuicideAssessment(q9: number[]): boolean {
  return sum(q9) >= 7;
}

export function scoreQ8(answers: boolean[], canControl?: boolean): number {
  const base = Q8_QUESTIONS.reduce((total, question, index) => total + (answers[index] ? question.score : 0), 0);
  return base + (answers[2] && canControl === false ? Q8_FOLLOW_UP.scoreIfCannot : 0);
}

export function interpretQ8(score: number): string {
  if (score === 0) return 'ไม่มีแนวโน้มฆ่าตัวตายในปัจจุบัน';
  if (score <= 8) return 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับน้อย';
  if (score <= 16) return 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับกลาง';
  return 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับรุนแรง';
}

/** dd/MM/yyyy in the Thai Buddhist year, from an ISO date. */
export function formatThaiDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${Number(year) + 543}`;
}

/** Whether a record should raise a mental-health alert, and how severe it is. */
export function mentalHealthAlert(record: Pick<VisitRecordInput, 'q9' | 'q8'>): { severity: 'HIGH' | 'MEDIUM' } | null {
  const q8Score = record.q8 ? scoreQ8(record.q8.answers, record.q8.canControl) : 0;
  const selfHarmThought = (record.q9?.[8] ?? 0) > 0;
  if (q8Score >= 17) return { severity: 'HIGH' };
  if (q8Score >= 1 || selfHarmThought) return { severity: 'MEDIUM' };
  return null;
}
