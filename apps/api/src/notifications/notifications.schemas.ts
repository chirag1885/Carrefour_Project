import { z } from 'zod';
export const FeedQuery = z.object({
  unread: z.enum(['true','false']).optional(),
  since: z.iso.datetime({offset:true}).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const FeedCursor = z.object({ at:z.iso.datetime(),id:z.uuid() });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
export const PreferencesSchema=z.object({
  channelInApp:z.boolean(),channelEmail:z.boolean(),
  // Preserve the existing contract shape while rejecting unsupported channels.
  channelPush:z.literal(false),channelWhatsapp:z.literal(false),
  deliveryMode:z.enum(['instant','daily_digest']),
  digestHourLocal:z.number().int().min(0).max(23),
  quietStart:time,quietEnd:time,
  minDropPercent:z.number().min(0).max(100).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-7),
  maxAlertsPerDay:z.number().int().min(0).max(32767),
}).refine(v=>(v.quietStart===null)===(v.quietEnd===null) &&
  (v.quietStart===null || v.quietStart!==v.quietEnd),{message:'Set both distinct quiet-hour boundaries or neither'});
export type PreferencesDto=z.infer<typeof PreferencesSchema>;
