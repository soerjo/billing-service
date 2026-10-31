import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { MidtransModule } from '../midtrans/midtrans.module.js';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { TenantBalanceModule } from '../tenant-balance/tenant-balance.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsRepository } from './payments.repository.js';

@Module({
  imports: [
    PrismaModule,
    MidtransModule,
    PaymentMethodsModule,
    OutboxModule,
    TenantBalanceModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService, PaymentsRepository],
})
export class PaymentsModule {}
