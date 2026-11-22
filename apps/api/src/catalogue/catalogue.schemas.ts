import { z } from 'zod';

export const CATEGORIES = [
  'Electronics',
  'Grocery',
  'Home & Kitchen',
  'Fashion',
  'Beauty & Personal Care',
  'Baby & Kids',
  'Toys & Games',
  'Health & Wellness',
] as const;

export const ListProductsQuery = z.object({
  query: z.string().trim().max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListProductsDto = z.infer<typeof ListProductsQuery>;

export const ProductCursor = z.object({ id: z.string().regex(/^[1-9][0-9]{0,17}$/) });