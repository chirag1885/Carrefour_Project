import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness + dependency check. Used by Docker/K8s probes and by the demo. */
  @Public()
  @Get()
  async check() {
    const [db, redis] = await Promise.all([
      this.db.query('SELECT 1').then(() => true).catch(() => false),
      this.redis.ping(),
    ]);
    return { status: db ? 'ok' : 'degraded', db, redis, time: new Date().toISOString() };
  }
}