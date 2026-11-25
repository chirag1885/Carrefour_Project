import { z } from 'zod';

export const ShareOptionsSchema = z
  .object({
    permission: z.enum(['view', 'contribute']).default('view'),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .default({ permission: 'view' }); // the request body is optional in the contract
export type ShareOptionsDto = z.infer<typeof ShareOptionsSchema>;

export const GiftClaimSchema = z.object({ claimedBy: z.string().trim().min(1).max(120) });
export type GiftClaimDto = z.infer<typeof GiftClaimSchema>;