const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decide, dropPercent } = require('../dist/alert-decision');
const { buildNotification } = require('../dist/alert-message');
const { ProductEvent, NotificationRequested, AlertFanout } = require('../dist/events');
const now = new Date('2026-11-24T10:00:00Z');
const quiet = new Date('2026-11-24T12:00:00Z');
const digest = new Date('2026-11-24T13:00:00Z');
const tomorrow = new Date('2026-11-25T05:00:00Z');
const event = { event_id: 'c2b0439a-6257-4dbf-8a27-ea33b243fade', schema_version: 1,
  occurred_at: now.toISOString(), product_id: 42, event_type: 'price.changed', sku: 'LAPTOP',
  old_price: 3000, new_price: 2500, currency: 'AED', source: 'admin' };
const stock = { event_id: event.event_id, schema_version: 1, occurred_at: event.occurred_at,
  product_id: 42, event_type: 'stock.changed', store_id: 1, old_qty: 0, new_qty: 4 };
const item = { targetPrice: null, notifyOnDrop: true, notifyOnRestock: true,
  notifyOnLowStock: true, lowStockThreshold: 5, storeId: null };
const prefs = { minDropPercent: 2, maxAlertsPerDay: 5, channels: ['in_app', 'email'], deliveryMode: 'instant' };
const state = { dedupeHit: false, capCount: 0, lastNotifiedPrice: null, lowStockCooldown: false,
  quietUntil: null, nextDigestAt: digest, tomorrowDigestAt: tomorrow };
const S = reason => ({ action: 'suppress', reason });
const Y = (type='PRICE_DROP', deliverAfter=null, reason) => ({
  action: 'send', type, channels: prefs.channels, deliverAfter, ...(reason ? {reason} : {}) });
const cases = [
  ['normal drop', {}, {}, {}, {}, Y()],
  ['unchanged', {new_price:3000}, {}, {}, {}, S('not_a_drop')],
  ['increase', {new_price:3100}, {}, {}, {}, S('not_a_drop')],
  ['disabled', {}, {notifyOnDrop:false}, {}, {}, S('notify_disabled')],
  ['below minimum', {new_price:2990}, {}, {}, {}, S('below_min_drop')],
  ['exact minimum', {new_price:2940}, {}, {}, {}, Y()],
  ['one fils below minimum drop', {new_price:2940.01}, {}, {}, {}, S('below_min_drop')],
  ['target exact', {new_price:2990}, {targetPrice:2990}, {}, {}, Y('TARGET_REACHED')],
  ['target missed by fils', {new_price:2990.01}, {targetPrice:2990}, {}, {}, S('target_not_hit')],
  ['target missed but big drop', {}, {targetPrice:2000}, {}, {}, Y()],
  ['target exceeded', {}, {targetPrice:2600}, {}, {}, Y('TARGET_REACHED')],
  ['hysteresis equal', {}, {}, {}, {lastNotifiedPrice:2500}, S('hysteresis')],
  ['hysteresis higher', {}, {}, {}, {lastNotifiedPrice:2499}, S('hysteresis')],
  ['hysteresis new low', {}, {}, {}, {lastNotifiedPrice:2500.01}, Y()],
  ['dedupe', {}, {}, {}, {dedupeHit:true}, S('dedupe')],
  ['cap exact', {}, {}, {}, {capCount:5}, Y('PRICE_DROP',tomorrow,'cap_exceeded')],
  ['cap above', {}, {}, {}, {capCount:6}, Y('PRICE_DROP',tomorrow,'cap_exceeded')],
  ['one under cap', {}, {}, {}, {capCount:4}, Y()],
  ['quiet', {}, {}, {}, {quietUntil:quiet}, Y('PRICE_DROP',quiet,'quiet_hours')],
  ['quiet ends now', {}, {}, {}, {quietUntil:now}, Y()],
  ['quiet expired', {}, {}, {}, {quietUntil:new Date(0)}, Y()],
  ['cap beats quiet', {}, {}, {}, {capCount:5,quietUntil:quiet}, Y('PRICE_DROP',tomorrow,'cap_exceeded')],
  ['dedupe beats cap', {}, {}, {}, {capCount:5,dedupeHit:true}, S('dedupe')],
  ['digest', {}, {}, {deliveryMode:'digest'}, {}, Y('PRICE_DROP',digest,'digest')],
  ['digest with longer quiet', {}, {}, {deliveryMode:'digest'}, {quietUntil:tomorrow}, Y('PRICE_DROP',tomorrow,'digest')],
  ['no channels', {}, {}, {channels:[]}, {}, S('no_channels')],
  ['0 minimum still requires drop', {new_price:3000}, {}, {minDropPercent:0}, {}, S('not_a_drop')],
  ['0 minimum tiny drop', {new_price:2999.99}, {}, {minDropPercent:0}, {}, Y()],
  ['target disabled', {}, {targetPrice:2500,notifyOnDrop:false}, {}, {}, S('notify_disabled')],
  ['restock global', stock, {}, {}, {}, Y('BACK_IN_STOCK')],
  ['restock matching store', stock, {storeId:1}, {}, {}, Y('STORE_BACK_IN_STOCK')],
  ['wrong store', stock, {storeId:2}, {}, {}, S('store_mismatch')],
  ['restock disabled', stock, {notifyOnRestock:false}, {}, {}, S('notify_disabled')],
  ['low threshold exact', {...stock,old_qty:6,new_qty:5}, {}, {}, {}, Y('LOW_STOCK')],
  ['low threshold from exact', {...stock,old_qty:5,new_qty:4}, {}, {}, {}, S('no_stock_transition')],
  ['low disabled', {...stock,old_qty:6,new_qty:4}, {notifyOnLowStock:false}, {}, {}, S('notify_disabled')],
  ['low cooldown', {...stock,old_qty:6,new_qty:4}, {}, {}, {lowStockCooldown:true}, S('cooldown')],
  ['stock rises', {...stock,old_qty:4,new_qty:5}, {}, {}, {}, S('no_stock_transition')],
  ['sellout phase 5', {...stock,old_qty:6,new_qty:0}, {}, {}, {}, S('no_stock_transition')],
  ['restock quiet', stock, {}, {}, {quietUntil:quiet}, Y('BACK_IN_STOCK',quiet,'quiet_hours')],
  ['restock duplicate', stock, {}, {}, {dedupeHit:true}, S('dedupe')],
];
for (const [name,e,i,p,s,expected] of cases) {
  test(name, () => assert.deepEqual(decide({...event,...e},{...item,...i},{...prefs,...p},{...state,...s},now),expected));
}
test('money rounds to 16.67%', () => assert.equal(dropPercent(3000,2500),16.67));
test('shared event fixtures parse and unknown version fails', () => {
  assert.ok(ProductEvent.safeParse(event).success);
  assert.ok(ProductEvent.safeParse(stock).success);
  assert.equal(ProductEvent.safeParse({...event,schema_version:2}).success,false);
  assert.equal(ProductEvent.safeParse({...event,new_price:10.001}).success,false);
});
test('notification is deterministic and preserves source timestamp', () => {
  const user = 'bf76f029-d58c-423b-b1b8-c200c272e481';
  const d = decide(event,item,prefs,state,now);
  const enrichment = {lowestInDays:90,offerLabel:null,addedPrice:3000};
  const n = buildNotification(event,user,item,d,enrichment);
  assert.deepEqual(n,buildNotification(event,user,item,d,enrichment));
  assert.equal(n.payload.savings_vs_added,500);
  assert.equal(n.occurred_at,event.occurred_at);
  assert.equal(NotificationRequested.safeParse({...n,idempotency_key:'bad'}).success,false);
});
test('fanout cursor is lossless and range checked', () => {
  const fan = { ...event, event_type:'alert.fanout', cursor_from:'9007199254740993',cursor_to:'9007199254740994',price_event:event };
  assert.ok(AlertFanout.safeParse(fan).success);
  assert.equal(AlertFanout.safeParse({...fan,cursor_to:fan.cursor_from}).success,false);
});
