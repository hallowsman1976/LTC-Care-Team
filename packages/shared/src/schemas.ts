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

export const schedulePatternSchema = z.discriminatedUnion('unit', [
  z.object({
    unit: z.literal('WEEK'),
    count: z.number().int().min(1).max(7),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1),
    windowStart: z.string().regex(/^\d{2}:\d{2}$/),
    windowEnd: z.string().regex(/^\d{2}:\d{2}$/)
  }),
  z.object({
    unit: z.literal('MONTH'),
    count: z.number().int().min(1).max(28),
    mode: z.enum(['DAY_OF_MONTH', 'NTH_WEEKDAY']),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    nth: z.number().int().min(1).max(4).optional(),
    weekday: z.number().int().min(1).max(7).optional(),
    windowStart: z.string().regex(/^\d{2}:\d{2}$/),
    windowEnd: z.string().regex(/^\d{2}:\d{2}$/)
  })
]);

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

