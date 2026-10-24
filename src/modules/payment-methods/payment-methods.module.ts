import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PaymentMethodsController } from './payment-methods.controller.js';
import { PaymentMethodsService } from './payment-methods.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
