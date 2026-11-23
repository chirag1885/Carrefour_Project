import { z } from 'zod';

export const PriceHistoryQuery = z.object({
  range: z.enum(['7d', '30d', '90d', '1y']).default('30d'),
});
export type PriceHistoryDto = z.infer<typeof PriceHistoryQuery>;

/** A single point as returned by the endpoint. minPrice and maxPrice are optional (absent for 7d). */
export interface PricePoint {
  at: string;         // ISO-8601 UTC
  price: number;      // AED, 2 decimal places
  minPrice?: number;
  maxPrice?: number;
}

export interface PriceHistoryResponse {
  currency: 'AED';
  points: PricePoint[];
}
