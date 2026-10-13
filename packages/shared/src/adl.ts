import { z } from 'zod';

export const adlAssessmentItemsSchema = z.object({
  feeding: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  grooming: z.union([z.literal(0), z.literal(1)]),
  transfer: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  toiletUse: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  mobility: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  dressing: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  stairs: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  bathing: z.union([z.literal(0), z.literal(1)]),
  bowels: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  bladder: z.union([z.literal(0), z.literal(1), z.literal(2)])
});

export type AdlItems = z.infer<typeof adlAssessmentItemsSchema>;

export function calculateAdlTotal(items: AdlItems): number {
  return Object.values(items).reduce<number>((sum, score) => sum + score, 0);
}

export function describeAdl(total: number): 'BED_BOUND' | 'HOME_BOUND' | 'SOCIAL' {
  if (!Number.isInteger(total) || total < 0 || total > 20) throw new Error('INVALID_ADL_TOTAL');
  if (total <= 4) return 'BED_BOUND';
  if (total <= 11) return 'HOME_BOUND';
  return 'SOCIAL';
}

