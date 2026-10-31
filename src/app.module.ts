import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { RedisModule } from './common/redis/redis.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { MidtransModule } from './modules/midtrans/midtrans.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module.js';
import { SignaturesModule } from './modules/signatures/signatures.module.js';
import { TenantBalanceModule } from './modules/tenant-balance/tenant-balance.module.js';
import { PayoutsModule } from './modules/payouts/payouts.module.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';
import { loggerConfig } from './config/logger.config.js';
import { validate } from './config/env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    WinstonModule.forRoot(loggerConfig),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    RedisModule,
    PrismaModule,
    HealthModule,
    MetricsModule,
    PaymentsModule,
    MidtransModule,
    WebhooksModule,
    OutboxModule,
    PaymentMethodsModule,
    SignaturesModule,
    TenantBalanceModule,
    PayoutsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
