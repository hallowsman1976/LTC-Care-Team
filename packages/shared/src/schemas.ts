import { z } from 'zod';
import { DEPENDENCY_OPTIONS, MENTAL_HEALTH_OPTIONS, PATIENT_STATUS_OPTIONS, RELATIONSHIP_OPTIONS, RIGHT_TYPE_OPTIONS, SEX_OPTIONS, TAI_GROUP_OPTIONS } from './patient';

export const roleSchema = z.enum(['ADMIN', 'CM', 'CG']);

const codes = <T extends readonly (readonly [string, string])[]>(pairs: T) =>
  z.enum(pairs.map(([value]) => value) as [T[number][0], ...T[number][0][]], { errorMap: () => ({ message: 'กรุณาเลือก' }) });
/** An optional choice: the form's empty "not chosen" option means absent. */
const optionalCode = <T extends readonly (readonly [string, string])[]>(pairs: T) => z.preprocess((value) => (value === '' ? undefined : value), codes(pairs).optional());
/** An optional number typed into a text or number input; empty means absent. */
const optionalNumber = (schema: z.ZodNumber) => z.preprocess((value) => (value === '' || value == null || (typeof value === 'number' && Number.isNaN(value)) ? undefined : Number(value)), schema.optional());
const optionalPhone = z.string().transform((value) => value.replace(/[\s-]/g, '')).pipe(z.union([z.literal(''), z.string().regex(/^0\d{8,9}$/, 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0')]));
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const patientCreateSchema = z.object({
  // Kept for units that already number their register; the HN identifies the patient.
  localCode: z.string().trim().max(40).default(''),
  hn: z.string().trim().min(1, 'กรอก HN').max(40),
  cid: z.string().trim().regex(/^\d{13}$/, 'กรุณากรอกเลข 13 หลัก'),
  fullName: z.string().trim().min(2, 'กรอกชื่อ–สกุล').max(160),
  birthDate: z.string().date('เลือกวันเกิด'),
  sex: codes(SEX_OPTIONS),
  address: z.string().trim().min(1, 'กรอกบ้านเลขที่/ที่อยู่').max(500),
  /** The village as lists show it, e.g. "หมู่ 2 บ้านหนองบัว"; derived from villageNo and villageName when they are given. */
  village: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(30).optional(),
  villageNo: z.string().trim().regex(/^\d{0,3}$/, 'ใส่เป็นตัวเลข').optional(),
  villageName: optionalText(80),
  subdistrict: optionalText(80),
  district: optionalText(80),
  province: optionalText(80),
  latitude: optionalNumber(z.number().min(-90).max(90)),
  longitude: optionalNumber(z.number().min(-180).max(180)),
  mainCaregiverName: optionalText(160),
  mainCaregiverPhone: optionalPhone.optional(),
  relationship: optionalCode(RELATIONSHIP_OPTIONS),
  rightType: optionalCode(RIGHT_TYPE_OPTIONS),
  diseases: optionalText(500),
  dependencyStatus: optionalCode(DEPENDENCY_OPTIONS),
  adlScore: optionalNumber(z.number().int().min(0).max(20)),
  taiGroup: optionalCode(TAI_GROUP_OPTIONS),
  ppsScore: optionalNumber(z.number().int().min(0).max(100).multipleOf(10)),
  mentalHealthStatus: optionalCode(MENTAL_HEALTH_OPTIONS),
  careManagerId: optionalText(80),
  caregiverId: optionalText(80),
  registerDate: z.string().date().optional(),
  legalBasis: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['PUBLIC_HEALTH', 'MEDICAL_CARE', 'LEGAL_OBLIGATION', 'EXPLICIT_CONSENT']).optional()),
  privacyNoticeVersion: z.string().trim().max(40).optional(),
  duplicateOverrideReason: z.string().trim().min(10).max(500).optional()
});

export const patientGetSchema = z.object({ patientId: z.string().trim().min(1).max(80) });

/**
 * An edit. Empty `cid` keeps the stored one. Moving `status` away from ACTIVE closes the care
 * episode; an empty `caregiverId` ends the current CG assignment.
 */
export const patientUpdateSchema = patientCreateSchema
  .omit({ cid: true, legalBasis: true, privacyNoticeVersion: true, duplicateOverrideReason: true })
  .extend({
    patientId: z.string().trim().min(1).max(80),
    recordVersion: z.number().int().min(1),
    cid: z.union([z.literal(''), z.string().trim().regex(/^\d{13}$/, 'กรุณากรอกเลข 13 หลัก')]),
    status: codes(PATIENT_STATUS_OPTIONS),
    statusNote: z.string().trim().max(300).optional()
  });

export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const schedulePatternSchema = z.discriminatedUnion('unit', [
  z.object({
    unit: z.literal('WEEK'),
    count: z.number().int().min(1).max(7),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    windowStart: timeOfDay,
    windowEnd: timeOfDay
  }),
  z.object({
    unit: z.literal('MONTH'),
    count: z.literal(1),
    mode: z.enum(['DAY_OF_MONTH', 'NTH_WEEKDAY']),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    nth: z.number().int().min(1).max(4).optional(),
    weekday: z.number().int().min(1).max(7).optional(),
    windowStart: timeOfDay,
    windowEnd: timeOfDay
  })
]).superRefine((pattern, context) => {
  if (pattern.windowEnd <= pattern.windowStart) context.addIssue({ code: 'custom', path: ['windowEnd'], message: 'WINDOW_END_BEFORE_START' });
  if (pattern.unit === 'WEEK') {
    // count is visits per week; each visit needs its own distinct weekday.
    if (new Set(pattern.weekdays).size !== pattern.weekdays.length) context.addIssue({ code: 'custom', path: ['weekdays'], message: 'DUPLICATE_WEEKDAY' });
    if (pattern.weekdays.length !== pattern.count) context.addIssue({ code: 'custom', path: ['weekdays'], message: 'WEEKDAYS_MUST_MATCH_COUNT' });
    return;
  }
  if (pattern.mode === 'DAY_OF_MONTH' && pattern.dayOfMonth === undefined) context.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'DAY_OF_MONTH_REQUIRED' });
  if (pattern.mode === 'NTH_WEEKDAY' && (pattern.nth === undefined || pattern.weekday === undefined)) context.addIssue({ code: 'custom', path: ['nth'], message: 'NTH_WEEKDAY_REQUIRED' });
});

export type SchedulePattern = z.infer<typeof schedulePatternSchema>;

export const apiRequestSchema = z.object({
  apiVersion: z.literal('v1'),
  action: z.string().min(1).max(100),
  requestId: z.string().uuid(),
  auth: z.object({
    subject: z.string().min(1),
    iat: z.number().int(),
    exp: z.number().int(),
    nonce: z.string().min(16).max(200),
    bodyHash: z.string().min(32),
    signature: z.string().min(32)
  }),
  payload: z.record(z.unknown())
});

