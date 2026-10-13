import { z } from 'zod';

export const roleSchema = z.enum(['ADMIN', 'CM', 'CG']);

export const patientCreateSchema = z.object({
  localCode: z.string().trim().min(1).max(40),
  hn: z.string().trim().min(1).max(40),
  cid: z.string().trim().regex(/^\d{13}$/, 'กรุณากรอกเลข 13 หลัก'),
  fullName: z.string().trim().min(2).max(160),
  birthDate: z.string().date(),
  sex: z.enum(['FEMALE', 'MALE', 'OTHER', 'UNKNOWN']),
  address: z.string().trim().min(1).max(500),
  village: z.string().trim().max(80),
  phone: z.string().trim().max(30).optional(),
  legalBasis: z.enum(['PUBLIC_HEALTH', 'MEDICAL_CARE', 'LEGAL_OBLIGATION', 'EXPLICIT_CONSENT']).optional(),
  privacyNoticeVersion: z.string().trim().max(40).optional(),
  duplicateOverrideReason: z.string().trim().min(10).max(500).optional()
});

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

