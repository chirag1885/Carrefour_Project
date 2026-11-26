import { z } from 'zod';

export const OverviewQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export type OverviewDto = z.infer<typeof OverviewQuery>;

export const ActivityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
export type ActivityDto = z.infer<typeof ActivityQuery>;