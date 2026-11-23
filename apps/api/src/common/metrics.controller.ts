import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { MetricsService } from './metrics';

/** Prometheus scrape endpoint. No auth — scrape is internal. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@Res() res: Response): Promise<void> {
    res.send(await this.metrics.registry.metrics());
  }
}
