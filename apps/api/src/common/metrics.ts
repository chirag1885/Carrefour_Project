/**
 * Lightweight Prometheus metrics for the API (WI-8).
 *
 * Exposed on GET /metrics (no auth — Prometheus scrapes from inside the cluster).
 * Controllers and services inject MetricsService directly; we avoid the prom-client
 * global registry so the metrics are reset between test runs.
 */
import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly priceWriteTotal = new Counter({
    name: 'price_write_total',
    help: 'Price change requests by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly priceWriteDuration = new Histogram({
    name: 'price_write_duration_seconds',
    help: 'Price write transaction duration',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  readonly stockWriteTotal = new Counter({
    name: 'stock_write_total',
    help: 'Stock change requests by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });
}
