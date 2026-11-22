import { z } from 'zod';
import { filsFromNumber } from '../common/money';

/** Contract: SetPrice.price maximum (NUMERIC(10,2) holds up to 99,999,999.99). */
export const MAX_PRICE = 99_999_999.99;

/**
 * The contract sets no upper bound for stock. products.total_stock is a 32-bit INT, so we cap each
 * store at 10 million: even 200 stores cannot overflow it and turn a typo into a 500 error.
 */
export const MAX_STOCK_PER_STORE = 10_000_000;

const hasMoneyPrecision = (n: number): boolean => {
  try {
    filsFromNumber(n);
    return true;
  } catch {
    return false;
  }
};

/** PUT /admin/products/{id}/price. Unknown fields are rejected so typos do not pass silently. */
export const SetPriceSchema = z.strictObject({
  price: z
    .number()
    .positive()
    .max(MAX_PRICE)
    .refine(hasMoneyPrecision, { message: 'Price must have at most 2 decimal places' }),
  source: z.enum(['admin', 'promo']).default('admin'),
});
export type SetPriceDto = z.output<typeof SetPriceSchema>;

/**
 * PUT /admin/products/{id}/stock.
 *  storeId given          -> set that store's quantity.
 *  storeId null / omitted -> global: spread the target total over the product's existing store rows
 *                            (decision D-1 in the Phase 3 prompt; see StockWriteService.distributeStock).
 */
export const SetStockSchema = z.strictObject({
  quantity: z.number().int().min(0).max(MAX_STOCK_PER_STORE),
  storeId: z.number().int().min(1).nullish(),
});
export type SetStockDto = z.output<typeof SetStockSchema>;

/** Same shape the catalogue accepts (BigId). */
const PRODUCT_ID_RE = /^[1-9][0-9]{0,17}$/;
export const isProductId = (id: string): boolean => PRODUCT_ID_RE.test(id);
