import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

/**
 * Redis is an accelerator, not the source of truth: callers must tolerate failures.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger('Redis');
  readonly client: Redis;

  constructor() {
    const opts = { maxRetriesPerRequest: 1, connectTimeout: 2000 };
    this.client = env.REDIS_URL
      ? new Redis(env.REDIS_URL, opts)
      : new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT, ...opts });
    this.client.on('error', (e) => this.log.warn(`redis error: ${e.message}`));
  }

  /** Fixed-window counter. Returns the new count; sets the TTL on first hit. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, windowSeconds);
    return n;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}