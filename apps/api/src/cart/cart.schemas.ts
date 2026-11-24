import { z } from 'zod';

export const AddCartItemSchema = z.object({
  productId: z.string().regex(/^[1-9][0-9]{0,17}$/, 'must be a numeric id'),
  quantity: z.number().int().min(1).max(99),
});
export type AddCartItemDto = z.infer<typeof AddCartItemSchema>;

export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(99),
});
export type UpdateCartItemDto = z.infer<typeof UpdateCartItemSchema>;