import type { PoolClient } from 'pg';

export interface Delivery {
  id: string; notification_id: string; channel: 'in_app'|'email';
  attempts: number; type: string; payload: Record<string,unknown>;
  email: string; locale: string; channel_email: boolean; channel_in_app: boolean;
}
export type SendEmail = (job: Delivery) => Promise<void>;
export const RETRY_SECONDS = [60,300,1800,1800,1800];
export async function dispatchOne(c: PoolClient, sendEmail: SendEmail): Promise<boolean> {
  const r=await c.query<Delivery>(`SELECT d.id,d.notification_id,d.channel,d.attempts,n.type,n.payload,
    u.email,u.locale,p.channel_email,p.channel_in_app FROM notification_deliveries d
    JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=n.user_id
    JOIN user_preferences p ON p.user_id=u.id
    WHERE d.status='pending' AND d.next_attempt_at<=now() AND d.channel IN ('in_app','email')
    ORDER BY CASE WHEN d.channel='in_app' THEN 0 ELSE 1 END,d.next_attempt_at,d.id
    LIMIT 1 FOR UPDATE OF n,d SKIP LOCKED`);
  const job=r.rows[0];
  if (!job) return false;
  const enabled=job.channel==='email'?job.channel_email:job.channel_in_app;
  let status='sent', reason: string|null=null, delay=0;
  if (!enabled) {status='cancelled';reason='channel_disabled';}
  else if (job.channel==='email') {
    try { await sendEmail(job); }
    catch(e) {
      const code=Number((e as {responseCode?:number})?.responseCode);
      const permanent=code>=500 && code<600;
      status=permanent || job.attempts>=RETRY_SECONDS.length?'dead':'pending';
      reason=permanent?'smtp_permanent':'smtp_transient';
      if (status==='pending') delay=RETRY_SECONDS[job.attempts];
    }
  }
  await c.query(`UPDATE notification_deliveries SET status=$2,attempts=attempts+1,last_error=$3,
    next_attempt_at=now()+make_interval(secs=>$4),sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END
    WHERE id=$1`,[job.id,status,reason,delay]);
  await c.query(`UPDATE notifications SET status=CASE
    WHEN EXISTS(SELECT 1 FROM notification_deliveries WHERE notification_id=$1 AND status='sent') THEN 'sent'
    WHEN EXISTS(SELECT 1 FROM notification_deliveries WHERE notification_id=$1 AND status='pending') THEN status
    ELSE 'failed' END WHERE id=$1`,[job.notification_id]);
  return true;
}
