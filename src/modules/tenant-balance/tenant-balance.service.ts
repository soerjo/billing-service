import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MutationCategory,
  MutationType,
  Prisma,
  TenantBalance,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

type Amount = number | Prisma.Decimal;

interface MutationParams {
  organizationId: string;
  amount: Amount;
  category: MutationCategory;
  referenceId?: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class TenantBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateBalance(
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<TenantBalance> {
    const client = tx ?? this.prisma;
    return client.tenantBalance.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
  }

  async credit(
    params: MutationParams,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const amount = this.toAmount(params.amount);
    return this.run(async (client) => {
      const balance = await this.loadForUpdate(params.organizationId, client);
      const balanceBefore = balance.availableBalance;
      const balanceAfter = balanceBefore.plus(amount);

      await client.tenantBalance.update({
        where: { id: balance.id },
        data: { availableBalance: { increment: amount } },
      });
      await this.createMutation(client, MutationType.CREDIT, params, {
        amount,
        balanceBefore,
        balanceAfter,
      });
      return balanceAfter;
    }, tx);
  }

  async debit(
    params: MutationParams,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const amount = this.toAmount(params.amount);
    return this.run(async (client) => {
      const balance = await this.loadForUpdate(params.organizationId, client);
      const balanceBefore = balance.availableBalance;
      if (balanceBefore.lt(amount)) {
        throw new BadRequestException('Insufficient available balance');
      }
      const balanceAfter = balanceBefore.minus(amount);

      await client.tenantBalance.update({
        where: { id: balance.id },
        data: { availableBalance: { decrement: amount } },
      });
      await this.createMutation(client, MutationType.DEBIT, params, {
        amount,
        balanceBefore,
        balanceAfter,
      });
      return balanceAfter;
    }, tx);
  }

  async lockBalance(
    organizationId: string,
    amount: Amount,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const value = this.toAmount(amount);
    await this.run(async (client) => {
      const balance = await this.loadForUpdate(organizationId, client);
      if (balance.availableBalance.lt(value)) {
        throw new BadRequestException('Insufficient available balance');
      }
      await client.tenantBalance.update({
        where: { id: balance.id },
        data: {
          availableBalance: { decrement: value },
          lockedBalance: { increment: value },
        },
      });
    }, tx);
  }

  async unlockBalance(
    organizationId: string,
    amount: Amount,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const value = this.toAmount(amount);
    await this.run(async (client) => {
      const balance = await this.loadForUpdate(organizationId, client);
      if (balance.lockedBalance.lt(value)) {
        throw new BadRequestException('Insufficient locked balance');
      }
      await client.tenantBalance.update({
        where: { id: balance.id },
        data: {
          availableBalance: { increment: value },
          lockedBalance: { decrement: value },
        },
      });
    }, tx);
  }

  /**
   * Finalizes a payout whose funds were previously moved to lockedBalance.
   * The mutation's balanceBefore/balanceAfter track the total of available
   * plus locked balance, since the funds have already left availableBalance.
   */
  async completePayoutDebit(
    params: Omit<MutationParams, 'category'> & { referenceId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const amount = this.toAmount(params.amount);
    await this.run(async (client) => {
      const balance = await this.loadForUpdate(params.organizationId, client);
      if (balance.lockedBalance.lt(amount)) {
        throw new BadRequestException('Insufficient locked balance');
      }
      const balanceBefore = balance.availableBalance.plus(
        balance.lockedBalance,
      );
      const balanceAfter = balanceBefore.minus(amount);

      await client.tenantBalance.update({
        where: { id: balance.id },
        data: { lockedBalance: { decrement: amount } },
      });
      await this.createMutation(
        client,
        MutationType.DEBIT,
        { ...params, category: MutationCategory.PAYOUT },
        { amount, balanceBefore, balanceAfter },
      );
    }, tx);
  }

  async getBalance(organizationId: string): Promise<TenantBalance> {
    return this.getOrCreateBalance(organizationId);
  }

  async getMutations(organizationId: string, page = 1, limit = 20) {
    const where = { organizationId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.balanceMutation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.balanceMutation.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  private run<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    tx?: Prisma.TransactionClient,
  ): Promise<T> {
    return tx ? fn(tx) : this.prisma.$transaction(fn);
  }

  /**
   * Ensures the balance row exists and takes a row-level lock so concurrent
   * mutations for the same tenant serialize. Must run inside a transaction.
   */
  private async loadForUpdate(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<TenantBalance> {
    const { id } = await this.getOrCreateBalance(organizationId, tx);
    await tx.$queryRaw`SELECT id FROM tenant_balances WHERE id = ${id} FOR UPDATE`;
    return tx.tenantBalance.findUniqueOrThrow({ where: { id } });
  }

  private createMutation(
    tx: Prisma.TransactionClient,
    type: MutationType,
    params: MutationParams,
    values: {
      amount: Prisma.Decimal;
      balanceBefore: Prisma.Decimal;
      balanceAfter: Prisma.Decimal;
    },
  ) {
    return tx.balanceMutation.create({
      data: {
        organizationId: params.organizationId,
        type,
        category: params.category,
        amount: values.amount,
        balanceBefore: values.balanceBefore,
        balanceAfter: values.balanceAfter,
        referenceId: params.referenceId,
        description: params.description,
        metadata: params.metadata,
      },
    });
  }

  private toAmount(amount: Amount): Prisma.Decimal {
    const value = new Prisma.Decimal(amount);
    if (!value.isFinite() || value.lte(0)) {
      throw new BadRequestException('Amount must be a positive number');
    }
    if (value.decimalPlaces() > 2) {
      throw new BadRequestException(
        'Amount must have at most 2 decimal places',
      );
    }
    return value;
  }
}
