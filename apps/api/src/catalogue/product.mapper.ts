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