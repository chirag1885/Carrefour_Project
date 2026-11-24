const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { materializeEvent } = require('../dist/alert-store');
const { dispatchOne } = require('../dist/delivery-store');
const user = 'bf76f029-d58c-423b-b1b8-c200c272e481';
const event = {
  event_id:'c2b0439a-6257-4dbf-8a27-ea33b243fade',schema_version:1,
  occurred_at:new Date().toISOString(),event_type:'price.changed',product_id:42,
  sku:'LAPTOP',old_price:3000,new_price:2500,currency:'AED',source:'admin',
};
async function fixture(t) {
  const db = new PGlite();
  t.after(()=>db.close());
  await db.exec(`
    CREATE TABLE users(id uuid PRIMARY KEY,email text,locale text,timezone text);
    CREATE TABLE user_preferences(user_id uuid PRIMARY KEY REFERENCES users(id),
      channel_in_app boolean DEFAULT true,channel_email boolean DEFAULT true,
      min_drop_percent numeric DEFAULT 2,max_alerts_per_day smallint DEFAULT 5,
      delivery_mode text DEFAULT 'instant',quiet_start time,quiet_end time,digest_hour_local smallint DEFAULT 9);
    CREATE TABLE wishlist_items(id bigserial PRIMARY KEY,user_id uuid,product_id bigint,target_price numeric,
      added_price numeric,notify_on_drop boolean DEFAULT true,notify_on_restock boolean DEFAULT true,
      notify_on_low_stock boolean DEFAULT false,low_stock_threshold int DEFAULT 5,store_id int,
      last_notified_price numeric,last_notified_at timestamptz,added_at timestamptz DEFAULT now()-interval '1 day');
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,product_id bigint,
      payload jsonb,idempotency_key text UNIQUE,status text,deliver_after timestamptz,
      created_at timestamptz DEFAULT now(),read_at timestamptz,clicked_at timestamptz);
    CREATE TABLE notification_deliveries(id bigserial PRIMARY KEY,notification_id uuid REFERENCES notifications(id),
      channel text,status text DEFAULT 'pending',attempts smallint DEFAULT 0,last_error text,sent_at timestamptz,
      UNIQUE(notification_id,channel));
  `);
  await db.exec(readFileSync(resolve(__dirname,'../../../db/migrations/20261124_001_web_email_alerts.sql'),'utf8'));
  await db.query("INSERT INTO users VALUES($1,'customer@example.test','en','Asia/Dubai')",[user]);
  await db.query('INSERT INTO user_preferences(user_id) VALUES($1)',[user]);
  await db.query('INSERT INTO wishlist_items(user_id,product_id,added_price) VALUES($1,42,3000)',[user]);
  // Match node-postgres results while using real PostgreSQL SQL in the embedded engine.
  const atomic = fn=>db.transaction(async trx=>fn({query:async(sql,params=[])=>{
    const r=await trx.query(sql,params);
    return {...r,rowCount:r.rows.length || r.affectedRows || 0};
  }}));
  return {db,atomic};
}
test('redelivery and rollback create one alert and two delivery jobs',async t=>{
  const {db,atomic}=await fixture(t);
  await assert.rejects(atomic(async c=>{await materializeEvent(c,event);throw new Error('crash');}));
  assert.equal((await db.query('SELECT count(*) n FROM notifications')).rows[0].n,0);
  assert.equal(await atomic(c=>materializeEvent(c,event)),1);
  assert.equal(await atomic(c=>materializeEvent(c,event)),0);
  assert.equal((await db.query('SELECT count(*) n FROM notification_deliveries')).rows[0].n,2);
});
test('email retry does not repeat web delivery; permanent failure is durable',async t=>{
  const {db,atomic}=await fixture(t);
  await atomic(c=>materializeEvent(c,event));
  await atomic(c=>dispatchOne(c,async()=>{throw new Error('web must not invoke email');}));
  let attempts=0;
  await atomic(c=>dispatchOne(c,async()=>{attempts++;throw new Error('temporary');}));
  let r=await db.query('SELECT channel,status,attempts FROM notification_deliveries ORDER BY channel');
  assert.deepEqual(r.rows,[{channel:'email',status:'pending',attempts:1},{channel:'in_app',status:'sent',attempts:1}]);
  assert.equal(await atomic(c=>dispatchOne(c,async()=>{attempts++;})),false);
  await db.exec("UPDATE notification_deliveries SET next_attempt_at=now() WHERE channel='email'");
  await atomic(c=>dispatchOne(c,async()=>{attempts++;throw Object.assign(new Error('mailbox unavailable'),{responseCode:550});}));
  r=await db.query("SELECT status FROM notification_deliveries WHERE channel='email'");
  assert.equal(r.rows[0].status,'dead');
  assert.equal(attempts,2);
});
test('cap reserves a slot on a later calendar day',async t=>{
  const {db,atomic}=await fixture(t);
  await db.exec('UPDATE user_preferences SET max_alerts_per_day=1');
  await atomic(c=>materializeEvent(c,event));
  const second={...event,event_id:'2cb0439a-6257-4dbf-8a27-ea33b243fade',old_price:2500,new_price:2000};
  await atomic(c=>materializeEvent(c,second));
  const {rows}=await db.query("SELECT (deliver_after AT TIME ZONE 'Asia/Dubai')::date::text AS day FROM notifications ORDER BY deliver_after");
  assert.equal(rows.length,2);
  assert.notEqual(rows[0].day,rows[1].day);
});
