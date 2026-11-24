import { KafkaJS } from '@confluentinc/kafka-javascript';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { pool, tx } from './db';
import { ProductEvent } from './events';
import { materializeEvent } from './alert-store';

const env = z.object({
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),
  ALERT_ENGINE_GROUP_ID: z.string().min(1).default('alert-engine'),
}).parse(process.env);
const kafka = new KafkaJS.Kafka({ 'bootstrap.servers': env.KAFKA_BROKERS });
const shutdown = new AbortController();
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => shutdown.abort());
async function main() {
  while (!shutdown.signal.aborted) {
    const session = new AbortController();
    const stop = () => session.abort();
    shutdown.signal.addEventListener('abort',stop,{once:true});
    const consumer = kafka.consumer({
      'group.id':env.ALERT_ENGINE_GROUP_ID, 'enable.auto.commit':false,
      'auto.offset.reset':'earliest','isolation.level':'read_committed',
      'allow.auto.create.topics':false,
    });
    try {
      await consumer.connect();
      await consumer.subscribe({topics:['price.changed','stock.changed']});
      await consumer.run({partitionsConsumedConcurrently:1,eachMessage:async ({topic,partition,message})=>{
        if (session.signal.aborted) return;
        try {
          let raw: unknown;
          try { raw=JSON.parse(message.value?.toString() ?? 'null'); } catch { raw=null; }
          const parsed=ProductEvent.safeParse(raw);
          if (parsed.success && parsed.data.event_type===topic &&
              String(parsed.data.product_id)===message.key?.toString()) {
            const n=await tx(c=>materializeEvent(c,parsed.data));
            console.log(JSON.stringify({event:'alerts_created',count:n,event_id:parsed.data.event_id}));
          } else console.warn(JSON.stringify({event:'invalid_alert_event',topic,partition,offset:message.offset}));
          await consumer.commitOffsets([{topic,partition,offset:(BigInt(message.offset)+1n).toString()}]);
        } catch {
          // Do not commit; reconnect and replay from Kafka.
          session.abort();
        }
      }});
      if (!shutdown.signal.aborted) await sleep(2**31-1,undefined,{signal:session.signal}).catch(()=>undefined);
    } catch { console.warn(JSON.stringify({event:'alert_consumer_reconnect'})); }
    finally {
      session.abort();
      await consumer.disconnect().catch(()=>undefined);
      shutdown.signal.removeEventListener('abort',stop);
    }
    await sleep(1000,undefined,{signal:shutdown.signal}).catch(()=>undefined);
  }
  await pool.end();
}
void main().catch(()=>{process.exitCode=1;});
