import { z } from 'zod';

const bigId = z.string().regex(/^[1-9][0-9]{0,17}$/, 'must be a numeric id');
const price = z
  .number()
  .min(0)
  .max(99999999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'at most 2 decimals');

export const WishlistNameSchema = z.object({ name: z.string().trim().min(1).max(100) });
export type WishlistNameDto = z.infer<typeof WishlistNameSchema>;

const options = {
  targetPrice: price.nullable().optional(),
  notifyOnDrop: z.boolean().optional(),
  notifyOnRestock: z.boolean().optional(),
  notifyOnLowStock: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).max(1000).optional(),
  storeId: z.number().int().positive().nullable().optional(),
};

export const AddItemSchema = z.object({ productId: bigId, ...options });
export type AddItemDto = z.infer<typeof AddItemSchema>;

export const UpdateItemSchema = z
  .object(options)
  .refine((o) => Object.values(o).some((v) => v !== undefined), 'at least one field is required');
export type UpdateItemDto = z.infer<typeof UpdateItemSchema>;

export const ListItemsQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListItemsDto = z.infer<typeof ListItemsQuery>;
export const ItemCursor = z.object({ id: bigId });

export const MoveOptionsSchema = z
  .object({
    removeFromWishlist: z.boolean().default(true),
    notificationId: z.string().uuid().nullable().optional(),
  })
  .default({ removeFromWishlist: true }); // the request body is optional in the contract
export type MoveOptionsDto = z.infer<typeof MoveOptionsSchema>;