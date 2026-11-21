import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { AppError } from './errors';

export const IDEMPOTENT = 'idempotent';
/** Marks a POST handler as requiring an Idempotency-Key header (see docs/openapi.yaml). */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Stripe-style idempotency:
 *  - same key + same body  -> the first response is replayed (header Idempotent-Replayed: true)
 *  - same key, still running -> 409 IDEMPOTENCY_IN_PROGRESS
 *  - same key + different body -> 422 IDEMPOTENCY_KEY_REUSED
 * State lives in Redis for 24h. If Redis is down we skip the check (DB unique constraints still protect us).
 * Note: a replayed response is the stored body; side effects such as Set-Cookie are not repeated.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly log = new Logger('Idempotency');

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (!this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [ctx.getHandler(), ctx.getClass()])) {
      return next.handle();
    }
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const header = req.header('idempotency-key');
    if (!header || header.length > 128) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header (1-128 chars) is required');
    }

    const scope = req.user?.id ?? `ip:${req.ip}`;
    const path = req.originalUrl.split('?')[0];
    const key = `idem:${scope}:${req.method}:${path}:${sha(header)}`;
    const fingerprint = sha(JSON.stringify(req.body ?? {}));
    const client = this.redis.client;

    let acquired: string | null;
    try {
      acquired = await client.set(key, JSON.stringify({ state: 'processing', fp: fingerprint }), 'EX', 60, 'NX');
    } catch (e) {
      this.log.warn(`redis unavailable, skipping idempotency check: ${(e as Error).message}`);
      return next.handle();
    }

    if (acquired !== 'OK') {
      const raw = await client.get(key).catch(() => null);
      const rec = raw ? (JSON.parse(raw) as { state: string; fp: string; body?: unknown }) : null;
      if (rec && rec.fp !== fingerprint) {
        throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body');
      }
      if (rec?.state === 'done') {
        res.setHeader('Idempotent-Replayed', 'true');
        return of(rec.body ?? null);
      }
      throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
    }

    return next.handle().pipe(
      mergeMap(async (body) => {
        await client
          .set(key, JSON.stringify({ state: 'done', fp: fingerprint, body: body ?? null }), 'EX', 86400)
          .catch(() => undefined);
        return body;
      }),
      catchError((err) => from(client.del(key).catch(() => 0)).pipe(mergeMap(() => throwError(() => err)))),
    );
  }
}