import { money } from '../common/money';

export interface ProductRow {
  id: string;
  sku: string;
  name_en: string;
  name_ar: string | null;
  category: string;
  subcategory: string | null;
  brand: string | null;
  image_url: string | null;
  current_price: string;
  list_price: string | null;
  currency: string;
  total_stock: number;
}

export const PRODUCT_COLS =
  'id, sku, name_en, name_ar, category, subcategory, brand, image_url, current_price, list_price, currency, total_stock';

/** DB row -> the contract's Product schema (camelCase, numbers for money, string BigId). */
export function toProduct(r: ProductRow) {
  return {
    id: r.id,
    sku: r.sku,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    category: r.category,
    subcategory: r.subcategory,
    brand: r.brand,
    imageUrl: r.image_url,
    currentPrice: money(r.current_price) as number,
    listPrice: money(r.list_price),
    currency: r.currency.trim(),
    totalStock: r.total_stock,
  };
}

// ---- helpers for queries that JOIN products onto another table (wishlist items, cart items) ----
const COL_LIST = PRODUCT_COLS.split(', ');

/** "p.id AS p_id, p.sku AS p_sku, ..." so product columns never clash with the other table's columns. */
export const PRODUCT_COLS_JOINED = COL_LIST.map((c) => `p.${c} AS p_${c}`).join(', ');

/** Pulls the p_* columns back out of a joined row. */
export function productRowFromJoin(r: Record<string, unknown>): ProductRow {
  const o: Record<string, unknown> = {};
  for (const c of COL_LIST) o[c] = r[`p_${c}`];
  return o as unknown as ProductRow;
}