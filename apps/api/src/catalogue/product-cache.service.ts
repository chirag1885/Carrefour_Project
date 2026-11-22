import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { RedisService } from '../redis/redis.service';
import type { ProductRow } from './product.mapper';

export type ProductDetailsRow = ProductRow & {
  description_en: string | null;
  attributes: Record<string, unknown> | null;
};

const FILL = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('DEL', KEYS[2])
return 1
`;

const RELEASE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

@Injectable()
export class ProductCacheService implements OnModuleDestroy {
  private readonly redis;

  constructor(redis: RedisService) {
    this.redis = redis.client.duplicate({ enableOfflineQueue: false, commandTimeout: 400 });
    this.redis.on('error', () => undefined);
  }

  async get(id: string, load: () => Promise<ProductDetailsRow | null>): Promise<ProductDetailsRow | null> {
    const key = `product:${id}`;
    const lock = `lock:product:${id}`;
    const token = randomUUID();

    let owner = false;
    try {
      const cached = await this.read(key);
      if (cached !== undefined) return cached;

      owner = (await this.redis.set(lock, token, 'EX', 5, 'NX')) === 'OK';
      if (owner) {
        const filled = await this.read(key);
        if (filled !== undefined) {
          await this.release(lock, token);
          return filled;
        }
      } else {
        for (const delay of [20, 40, 80]) {
          await sleep(delay);
          const filled = await this.read(key);
          if (filled !== undefined) return filled;
        }
      }
    } catch {
      if (owner) await this.release(lock, token);
      return load();
    }

    if (!owner) return load();

    try {
      const value = await load();
      const ttl = value === null ? 30 : 300 + Math.floor(Math.random() * 61);
      // Invalidation also deletes the lock. A delayed reader may fill only while it still owns it.
      await this.redis.eval(FILL, 2, key, lock, token, JSON.stringify(value), ttl).catch(() => undefined);
      return value;
    } finally {
      await this.release(lock, token);
    }
  }

  private async read(key: string): Promise<ProductDetailsRow | null | undefined> {
    const cached = await this.redis.get(key);
    if (cached === null) return undefined;
    return JSON.parse(cached) as ProductDetailsRow | null;
  }

  private async release(lock: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, lock, token).catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
