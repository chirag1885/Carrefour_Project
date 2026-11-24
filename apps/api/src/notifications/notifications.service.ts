import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { decodeCursor,encodeCursor } from '../common/cursor';
import { notFound } from '../common/errors';
import { z } from 'zod';
import { FeedQuery,FeedCursor,type PreferencesDto } from './notifications.schemas';

const VISIBLE = `EXISTS (SELECT 1 FROM notification_deliveries d
  WHERE d.notification_id=n.id AND d.channel='in_app' AND d.status='sent')`;
interface FeedRow {
  id:string; type:string; product_id:string|null; payload:Record<string,unknown>;
  status:string; at:string; read_at:Date|null; clicked_at:Date|null;
}
@Injectable()
export class NotificationsService {
  constructor(private readonly db:DbService) {}
  async list(userId:string,dto:z.infer<typeof FeedQuery>) {
    const cursor=decodeCursor(dto.cursor,FeedCursor);
    const r=await this.db.query<FeedRow>(`SELECT n.id,n.type,n.product_id,n.payload,n.status,
      to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
      n.read_at,n.clicked_at
      FROM notifications n WHERE n.user_id=$1 AND ${VISIBLE}
      AND (NOT $2::boolean OR n.read_at IS NULL)
      AND ($3::timestamptz IS NULL OR EXISTS (SELECT 1 FROM notification_deliveries d
        WHERE d.notification_id=n.id AND d.channel='in_app' AND d.sent_at>$3))
      AND ($4::timestamptz IS NULL OR (n.created_at,n.id)<($4::timestamptz,$5::uuid))
      ORDER BY n.created_at DESC,n.id DESC LIMIT $6`,
      [userId,dto.unread==='true',dto.since??null,cursor?.at??null,cursor?.id??null,dto.limit+1]);
    const page=r.rows.slice(0,dto.limit), last=page[page.length-1];
    return {items:page.map(n=>({id:n.id,type:n.type,productId:n.product_id,payload:n.payload,status:n.status,
      createdAt:n.at,readAt:n.read_at?.toISOString()??null,clickedAt:n.clicked_at?.toISOString()??null})),
      nextCursor:r.rows.length>dto.limit?encodeCursor({at:last.at,id:last.id}):null};
  }
  async unreadCount(userId:string) {
    const r=await this.db.query<{count:string}>(`SELECT count(*) FROM notifications n
      WHERE n.user_id=$1 AND n.read_at IS NULL AND ${VISIBLE}`,[userId]);
    return {count:Number(r.rows[0].count)};
  }
  private validateId(id:string) {
    if(!z.uuid().safeParse(id).success) throw notFound('NOTIFICATION_NOT_FOUND','Notification not found');
  }
  async read(userId:string,id:string) {
    this.validateId(id);
    const r=await this.db.query(`UPDATE notifications n SET read_at=COALESCE(read_at,now())
      WHERE n.id=$1 AND n.user_id=$2 AND ${VISIBLE}`,[id,userId]);
    if(!r.rowCount) throw notFound('NOTIFICATION_NOT_FOUND','Notification not found');
  }
  async readAll(userId:string) {
    await this.db.query(`UPDATE notifications n SET read_at=now()
      WHERE n.user_id=$1 AND n.read_at IS NULL AND ${VISIBLE}`,[userId]);
  }
  async click(userId:string,id:string) {
    this.validateId(id);
    await this.db.tx(async c=>{
      const r=await c.query<{clicked_at:Date|null;product_id:string|null}>(`SELECT clicked_at,product_id
        FROM notifications n WHERE n.id=$1 AND n.user_id=$2 FOR UPDATE`,[id,userId]);
      if(!r.rowCount) throw notFound('NOTIFICATION_NOT_FOUND','Notification not found');
      if(r.rows[0].clicked_at) return;
      await c.query('UPDATE notifications SET clicked_at=now() WHERE id=$1',[id]);
      await c.query(`INSERT INTO analytics_events(event_type,user_id,product_id,notification_id)
        VALUES('ALERT_CLICKED',$1,$2,$3)`,[userId,r.rows[0].product_id,id]);
    });
  }
  async preferences(userId:string) {
    const r=await this.db.query<PreferencesDto>(`SELECT channel_in_app AS "channelInApp",channel_email AS "channelEmail",
      false AS "channelPush",false AS "channelWhatsapp",delivery_mode AS "deliveryMode",
      digest_hour_local AS "digestHourLocal",left(quiet_start::text,5) AS "quietStart",
      left(quiet_end::text,5) AS "quietEnd",min_drop_percent::float8 AS "minDropPercent",
      max_alerts_per_day AS "maxAlertsPerDay" FROM user_preferences WHERE user_id=$1`,[userId]);
    if(!r.rowCount) throw notFound('PREFERENCES_NOT_FOUND','Preferences not found');
    return r.rows[0];
  }
  async replacePreferences(userId:string,d:PreferencesDto) {
    await this.db.tx(async c=>{
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
      await c.query(`UPDATE user_preferences SET channel_in_app=$2,channel_email=$3,channel_push=false,
        channel_whatsapp=false,push_subscription=NULL,delivery_mode=$4,digest_hour_local=$5,
        quiet_start=$6,quiet_end=$7,min_drop_percent=$8,max_alerts_per_day=$9,updated_at=now()
        WHERE user_id=$1`,[userId,d.channelInApp,d.channelEmail,d.deliveryMode,d.digestHourLocal,
        d.quietStart,d.quietEnd,d.minDropPercent,d.maxAlertsPerDay]);
    });
    return this.preferences(userId);
  }
}
