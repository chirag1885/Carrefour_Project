import type { Channel, NotificationType, ProductEvent } from './events';

export type SuppressReason = 'not_a_drop' | 'notify_disabled' | 'below_min_drop' |
  'target_not_hit' | 'hysteresis' | 'cooldown' | 'dedupe' | 'cap_exceeded' |
  'quiet_hours' | 'no_channels' | 'no_stock_transition' | 'store_mismatch';
export type Decision =
  | { action: 'send'; type: NotificationType; channels: Channel[]; deliverAfter: Date | null; reason?: 'cap_exceeded' | 'quiet_hours' | 'digest' }
  | { action: 'suppress'; reason: SuppressReason };
export interface WishlistItem {
  targetPrice: number | null;
  notifyOnDrop: boolean;
  notifyOnRestock: boolean;
  notifyOnLowStock: boolean;
  lowStockThreshold: number;
  storeId: number | null;
}
export interface UserPreferences {
  minDropPercent: number;
  maxAlertsPerDay: number;
  channels: Channel[];
  deliveryMode: 'instant' | 'digest';
}
export interface AlertState {
  dedupeHit: boolean;
  capCount: number;
  lastNotifiedPrice: number | null;
  lowStockCooldown: boolean;
  // Resolved by the I/O shell using the user's IANA timezone, DST-aware.
  quietUntil: Date | null;
  nextDigestAt: Date;
  tomorrowDigestAt: Date;
}
export const fils = (n: number) => BigInt(Math.round(n * 100));
export function dropPercent(oldPrice: number, newPrice: number): number {
  const old = fils(oldPrice), next = fils(newPrice);
  if (old <= 0n || next >= old) return 0;
  return Number(((old - next) * 10000n + old / 2n) / old) / 100;
}
const suppress = (reason: SuppressReason): Decision => ({ action: 'suppress', reason });
export function decide(event: ProductEvent, item: WishlistItem, prefs: UserPreferences, state: AlertState, now: Date): Decision {
  let type: NotificationType;
  if (event.event_type === 'price.changed') {
    const old = fils(event.old_price), next = fils(event.new_price);
    if (next >= old) return suppress('not_a_drop');
    if (!item.notifyOnDrop) return suppress('notify_disabled');
    const hit = item.targetPrice !== null && next <= fils(item.targetPrice);
    const enough = (old - next) * 10000n >= old * fils(prefs.minDropPercent);
    if (!hit && !enough) return suppress(item.targetPrice === null ? 'below_min_drop' : 'target_not_hit');
    if (state.lastNotifiedPrice !== null && next >= fils(state.lastNotifiedPrice)) return suppress('hysteresis');
    type = hit ? 'TARGET_REACHED' : 'PRICE_DROP';
  } else {
    // Phase 3 event has store quantities, not global stock transitions.
    if (item.storeId !== null && event.store_id !== item.storeId) return suppress('store_mismatch');
    if (event.old_qty === 0 && event.new_qty > 0) {
      if (!item.notifyOnRestock) return suppress('notify_disabled');
      type = item.storeId === null ? 'BACK_IN_STOCK' : 'STORE_BACK_IN_STOCK';
    } else if (event.new_qty > 0 && event.old_qty > item.lowStockThreshold && event.new_qty <= item.lowStockThreshold) {
      if (!item.notifyOnLowStock) return suppress('notify_disabled');
      if (state.lowStockCooldown) return suppress('cooldown');
      type = 'LOW_STOCK';
    } else return suppress('no_stock_transition');
  }
  if (state.dedupeHit) return suppress('dedupe');
  if (!prefs.channels.length) return suppress('no_channels');
  const channels = [...new Set(prefs.channels)];
  if (state.capCount >= prefs.maxAlertsPerDay) {
    return { action: 'send', type, channels, deliverAfter: state.tomorrowDigestAt, reason: 'cap_exceeded' };
  }
  const quiet = state.quietUntil && state.quietUntil > now ? state.quietUntil : null;
  if (prefs.deliveryMode === 'digest') {
    const deliverAfter = quiet && quiet > state.nextDigestAt ? quiet : state.nextDigestAt;
    return { action: 'send', type, channels, deliverAfter, reason: 'digest' };
  }
  if (quiet) return { action: 'send', type, channels, deliverAfter: quiet, reason: 'quiet_hours' };
  return { action: 'send', type, channels, deliverAfter: null };
}
