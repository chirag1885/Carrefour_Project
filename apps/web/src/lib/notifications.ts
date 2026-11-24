import { aed } from './format';
import type { AppNotification } from './types';

export interface Described {
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'info';
  icon: 'drop' | 'target' | 'stock' | 'low' | 'store' | 'similar' | 'digest';
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
};
// The Alert Engine may write payload keys as camelCase or snake_case: accept both.
const pick = (p: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (p[k] !== undefined && p[k] !== null) return p[k];
  return undefined;
};

/** Turns a notification (type + payload + joined product) into a friendly title and detail line. */
export function describeNotification(n: AppNotification): Described {
  const p = n.payload ?? {};
  const name = n.product?.nameEn ?? (pick(p, 'productName', 'product_name') as string | undefined) ?? 'An item on your wishlist';
  const oldPrice = num(pick(p, 'oldPrice', 'old_price'));
  const newPrice = num(pick(p, 'newPrice', 'new_price')) ?? n.product?.currentPrice ?? null;
  const dropPct = num(pick(p, 'dropPct', 'drop_pct')) ?? (oldPrice && newPrice ? ((oldPrice - newPrice) / oldPrice) * 100 : null);
  const lowest = num(pick(p, 'lowestInDays', 'lowest_in_days'));

  switch (n.type) {
    case 'PRICE_DROP': {
      const parts = [oldPrice && newPrice ? `${aed(oldPrice)} → ${aed(newPrice)}` : newPrice ? `Now ${aed(newPrice)}` : ''];
      if (dropPct && dropPct > 0) parts.push(`-${dropPct.toFixed(1)}%`);
      if (lowest) parts.push(`lowest in ${lowest} days`);
      return { title: `Price drop: ${name}`, detail: parts.filter(Boolean).join(' · '), tone: 'good', icon: 'drop' };
    }
    case 'TARGET_REACHED':
      return {
        title: `Your target price was reached: ${name}`,
        detail: newPrice ? `Now ${aed(newPrice)}` : 'Time to buy?',
        tone: 'good',
        icon: 'target',
      };
    case 'BACK_IN_STOCK':
      return { title: `Back in stock: ${name}`, detail: newPrice ? `Available at ${aed(newPrice)}` : 'Grab it before it sells out', tone: 'info', icon: 'stock' };
    case 'STORE_BACK_IN_STOCK': {
      const store = pick(p, 'storeName', 'store_name') as string | undefined;
      return { title: `Back at your store: ${name}`, detail: store ? `${store} · click & collect available` : 'Click & collect available', tone: 'info', icon: 'store' };
    }
    case 'LOW_STOCK': {
      const q = num(pick(p, 'quantity', 'qty', 'remaining'));
      return { title: `${q !== null ? `Only ${q} left` : 'Running low'}: ${name}`, detail: 'Order soon before it sells out', tone: 'warn', icon: 'low' };
    }
    case 'SIMILAR_SUGGESTION':
      return { title: `Similar to ${name}`, detail: "It's unavailable right now. Here are alternatives.", tone: 'info', icon: 'similar' };
    case 'DIGEST':
      return { title: 'Your wishlist digest', detail: 'A summary of what changed on your wishlist', tone: 'info', icon: 'digest' };
    default:
      return { title: 'Notification', detail: '', tone: 'info', icon: 'digest' };
  }
}