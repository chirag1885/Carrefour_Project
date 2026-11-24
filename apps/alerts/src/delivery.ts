import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { tx,pool } from './db';
import { dispatchOne,type Delivery } from './delivery-store';

// Runtime dependency; the small interface is deliberate to allow an injected fake in tests.
interface Transport {
  sendMail(options: {from:string;to:string;subject:string;text:string;messageId:string}):Promise<unknown>;
  close():void;
}
const nodemailer = require('nodemailer') as {createTransport(options:Record<string,unknown>):Transport};
const env=z.object({
  SMTP_HOST:z.string().min(1).default('localhost'),
  SMTP_PORT:z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_FROM:z.email().default('alerts@carrefour.test'),
  SMTP_USER:z.string().optional(),SMTP_PASSWORD:z.string().optional(),
  SMTP_SECURE:z.enum(['true','false']).default('false'),
  APP_WEB_URL:z.url().default('http://localhost:3000'),
}).parse(process.env);
if (Boolean(env.SMTP_USER)!==Boolean(env.SMTP_PASSWORD)) throw new Error('SMTP credentials must be set together');
const transport=nodemailer.createTransport({
  host:env.SMTP_HOST,port:env.SMTP_PORT,secure:env.SMTP_SECURE==='true',
  ...(env.SMTP_USER?{auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},requireTLS:env.SMTP_SECURE!=='true'}:{}),
  connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,
});
async function sendEmail(job:Delivery) {
  const ar=job.locale==='ar';
  const price=job.payload.new_price;
  const priceText=typeof price==='number'?(ar?'السعر الجديد: ':'New price: ')+price.toFixed(2)+' AED':'';
  const path=typeof job.payload.cta_url==='string'&&job.payload.cta_url.startsWith('/products/')?job.payload.cta_url:'/';
  await transport.sendMail({
    from:env.SMTP_FROM,to:job.email,
    subject:ar?'تنبيه قائمة الأمنيات':'Your wishlist update',
    text:[ar?'لديك تحديث جديد في قائمة الأمنيات.':'A product on your wishlist has changed.',priceText,new URL(path,env.APP_WEB_URL).href].filter(Boolean).join('\n'),
    messageId:'<'+job.notification_id+'@carrefour.test>',
  });
}
const stop=new AbortController();
for(const sig of ['SIGINT','SIGTERM'] as const) process.once(sig,()=>stop.abort());
async function main() {
  while(!stop.signal.aborted) {
    let work=false;
    try {work=await tx(c=>dispatchOne(c,sendEmail));}
    catch {console.error(JSON.stringify({event:'delivery_retry'}));}
    if(!work) await sleep(500,undefined,{signal:stop.signal}).catch(()=>undefined);
  }
  transport.close();
  await pool.end();
}
void main().catch(()=>{process.exitCode=1;});
