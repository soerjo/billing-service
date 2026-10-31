import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { TenantBalanceController } from './tenant-balance.controller.js';
import { TenantBalanceService } from './tenant-balance.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantBalanceController],
  providers: [TenantBalanceService],
  exports: [TenantBalanceService],
})
export class TenantBalanceModule {}
