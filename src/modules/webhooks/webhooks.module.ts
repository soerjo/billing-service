import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { MidtransModule } from '../midtrans/midtrans.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { TenantBalanceModule } from '../tenant-balance/tenant-balance.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [
    PrismaModule,
    MidtransModule,
    OutboxModule,
    TenantBalanceModule,
    PaymentsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
