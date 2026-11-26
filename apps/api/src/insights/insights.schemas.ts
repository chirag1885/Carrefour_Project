import { z } from 'zod';

export const PriceHistoryQuery = z.object({ range: z.enum(['7d', '15d', '30d', '90d']).default('90d') });
export type PriceHistoryDto = z.infer<typeof PriceHistoryQuery>;