import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async listEnabledVirtualAccountBanks() {
    return this.prisma.virtualAccountBank.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        code: true,
        name: true,
      },
    });
  }

  async findEnabledBank(code: string) {
    return this.prisma.virtualAccountBank.findFirst({
      where: { code, enabled: true },
    });
  }
}
