import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { createApp } from './app.factory';
import { env } from './config/env';

async function bootstrap() {
  const app = await createApp(AppModule);
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  new Logger('Bootstrap').log(`API listening on http://localhost:${env.API_PORT}${env.API_BASE_PATH}`);
}
void bootstrap();