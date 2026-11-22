import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestId } from './common/request-id';
import { env } from './config/env';

/** Shared by main.ts and the e2e tests so both run the exact same configuration. */
export function configureApp(app: NestExpressApplication): void {
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestId);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix(env.API_BASE_PATH.replace(/^\/+/, ''));
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'ETag', 'Idempotent-Replayed'],
  });
}

export async function createApp(module: unknown): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module as never, {
    logger: env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
  });
  configureApp(app);
  return app;
}