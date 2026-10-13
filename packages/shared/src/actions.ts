import { z } from 'zod';
import { adlAssessmentItemsSchema } from './adl';
import { schedulePatternSchema } from './schemas';

// Request contracts for the write actions. The gateway validates them before forwarding and GAS
// validates them again, so neither side trusts the other's input. Entity IDs that can be derived
// on the server (episode, ADL assessment) are never accepted from the client.

const entityId = z.string().trim().min(1).max(80);
const isoDate = z.string().date();
const isoDateTime = z.string().trim().min(1).max(40);

export const adlCreateSchema = z.object({
  patientId: entityId,
  assessmentDate: isoDate,
  items: adlAssessmentItemsSchema
});

export const ltcObservationSchema = z.object({
  mobilityStatus: z.enum(['INDEPENDENT', 'ASSISTED', 'DEPENDENT', 'UNKNOWN']),
  cognitiveStatus: z.enum(['NO_SIGNIFICANT_DISTURBANCE', 'DISTURBANCE', 'UNKNOWN']),
  terminalStatus: z.enum(['CONFIRMED', 'NOT_CONFIRMED', 'UNKNOWN'])
});

export const classificationConfirmSchema = z.object({
  patientId: entityId,
  observation: ltcObservationSchema,
  groupNumber: z.number().int().min(1).max(4),
  rationale: z.string().trim().min(10).max(1000)
});

export const carePlanCreateSchema = z.object({
  patientId: entityId,
  rulesetId: entityId,
  effectiveFrom: isoDate,
  effectiveTo: isoDate,
  goalsSummary: z.string().trim().min(10).max(2000),
  intervention: z.object({
    serviceType: z.string().trim().min(2).max(80),
    instructions: z.string().trim().min(10).max(2000),
    schedulePattern: schedulePatternSchema
  })
}).refine((plan) => plan.effectiveTo >= plan.effectiveFrom, { path: ['effectiveTo'], message: 'EFFECTIVE_TO_BEFORE_FROM' });

export const carePlanActivateSchema = z.object({
  carePlanId: entityId,
  recordVersion: z.number().int().min(1),
  approvalRationale: z.string().trim().max(1000).default('')
});

export const visitSubmitSchema = z.object({
  visitId: entityId,
  submissionId: z.string().uuid(),
  source: z.enum(['ONLINE', 'OFFLINE_DRAFT']),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  activityCompleted: z.boolean(),
  urgentFlag: z.boolean(),
  notes: z.string().max(2000),
  vitals: z.object({
    temperature: z.number().min(30).max(45).optional(),
    pulse: z.number().int().min(20).max(250).optional()
  }).default({}),
  checksum: z.string().max(128).optional()
});

export const encounterReviewSchema = z.object({
  encounterId: entityId,
  decision: z.enum(['VERIFIED', 'RETURNED']),
  reviewNotes: z.string().trim().max(1000).default(''),
  recordVersion: z.number().int().min(1)
}).refine((review) => review.decision !== 'RETURNED' || review.reviewNotes.length >= 10, { path: ['reviewNotes'], message: 'RETURN_REASON_REQUIRED' });

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const fileUploadSchema = z.object({
  encounterId: entityId,
  consentRef: entityId,
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  // base64 expands 3 bytes into 4 characters.
  base64: z.string().min(4).max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4)
});

export type AdlCreateInput = z.infer<typeof adlCreateSchema>;
export type ClassificationConfirmInput = z.infer<typeof classificationConfirmSchema>;
export type CarePlanCreateInput = z.infer<typeof carePlanCreateSchema>;
export type CarePlanActivateInput = z.infer<typeof carePlanActivateSchema>;
export type VisitSubmitInput = z.infer<typeof visitSubmitSchema>;
export type EncounterReviewInput = z.infer<typeof encounterReviewSchema>;
export type FileUploadInput = z.infer<typeof fileUploadSchema>;
