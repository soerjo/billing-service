import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { TenantBalanceModule } from '../tenant-balance/tenant-balance.module.js';
import { PayoutsController } from './payouts.controller.js';
import { PayoutsRepository } from './payouts.repository.js';
import { PayoutsService } from './payouts.service.js';

@Module({
  imports: [PrismaModule, TenantBalanceModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
  exports: [PayoutsService],
})
export class PayoutsModule {}
