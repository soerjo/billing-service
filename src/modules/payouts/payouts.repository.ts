import { Injectable, NotFoundException } from '@nestjs/common';
import { PayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface ListPayoutsParams {
  organizationId: string;
  status?: PayoutStatus;
  page: number;
  limit: number;
}

@Injectable()
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async create(
    data: Prisma.PayoutRequestUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.payoutRequest.create({ data });
  }

  async findById(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const payout = await client.payoutRequest.findUnique({ where: { id } });
    if (!payout) {
      throw new NotFoundException(`Payout '${id}' not found`);
    }
    return payout;
  }

  async findManyByOrganization(params: ListPayoutsParams) {
    const where: Prisma.PayoutRequestWhereInput = {
      organizationId: params.organizationId,
      status: params.status,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payoutRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.payoutRequest.count({ where }),
    ]);
    return { items, total, page: params.page, limit: params.limit };
  }

  /**
   * Compare-and-set on status: returns null when the payout is no longer in
   * one of `fromStatuses`, so a concurrent transition cannot be applied twice.
   */
  async updateStatusIf(
    id: string,
    fromStatuses: PayoutStatus[],
    data: Prisma.PayoutRequestUncheckedUpdateManyInput & {
      status: PayoutStatus;
    },
    tx: Prisma.TransactionClient,
  ) {
    const result = await tx.payoutRequest.updateMany({
      where: { id, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
  }
}
