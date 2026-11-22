import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { CatalogueModule } from './catalogue/catalogue.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency';
import { env } from './config/env';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { RedisModule } from './redis/redis.module';
import { StoresModule } from './stores/stores.module';
import { CartModule } from './cart/cart.module';
import { WishlistModule } from './wishlist/wishlist.module';

@Module({
  imports: [
    DbModule,
    RedisModule,
    JwtModule.register({
      global: true,
      secret: env.JWT_SECRET,
      signOptions: { algorithm: 'HS256' },
    }),
    AuthModule,
    CatalogueModule,
    StoresModule,
    WishlistModule,
    CartModule,
  ],
  controllers: [HealthController],
  providers: [
    // order matters: authenticate first, then check role
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}