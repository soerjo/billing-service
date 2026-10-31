import { BadRequestException } from '@nestjs/common';
import { MutationCategory, MutationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantBalanceService } from './tenant-balance.service.js';

const ORG = 'org-1';

function createClient(): Client {
  return {
    tenantBalance: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    balanceMutation: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
}

interface Client {
  tenantBalance: {
    upsert: jest.Mock;
    update: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  balanceMutation: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
}

function balance(available: number, locked = 0) {
  return {
    id: 'bal-1',
    organizationId: ORG,
    availableBalance: new Prisma.Decimal(available),
    lockedBalance: new Prisma.Decimal(locked),
  };
}

describe('TenantBalanceService', () => {
  let client: Client;
  let service: TenantBalanceService;

  // Runs the transaction callback against the same client, mirroring
  // prisma.$transaction(fn) without a database.
  function useInteractiveTransactions() {
    client.$transaction.mockImplementation(
      async (fn: (tx: Client) => Promise<unknown>) => fn(client),
    );
  }

  beforeEach(() => {
    client = createClient();
    // Partial Prisma stub: only the delegates the service touches are mocked.
    service = new TenantBalanceService(client as unknown as PrismaService);
    useInteractiveTransactions();
    client.$queryRaw.mockResolvedValue([]);
    client.balanceMutation.create.mockResolvedValue({});
    client.tenantBalance.update.mockResolvedValue({});
  });

  describe('getOrCreateBalance', () => {
    it('upserts the balance row keyed by organizationId', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(0));

      const result = await service.getOrCreateBalance(ORG);

      expect(client.tenantBalance.upsert).toHaveBeenCalledWith({
        where: { organizationId: ORG },
        create: { organizationId: ORG },
        update: {},
      });
      expect(result.organizationId).toBe(ORG);
    });
  });

  describe('credit', () => {
    it('increments available balance and records a CREDIT mutation', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(100));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(100));

      const after = await service.credit({
        organizationId: ORG,
        amount: 25.5,
        category: MutationCategory.PAYMENT_SETTLEMENT,
        referenceId: 'ref-1',
      });

      expect(after.toString()).toBe('125.5');
      expect(client.tenantBalance.update).toHaveBeenCalledWith({
        where: { id: 'bal-1' },
        data: {
          availableBalance: { increment: expect.anything() as Prisma.Decimal },
        },
      });
      expect(client.balanceMutation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG,
          type: MutationType.CREDIT,
          category: MutationCategory.PAYMENT_SETTLEMENT,
          referenceId: 'ref-1',
          balanceBefore: new Prisma.Decimal(100),
          balanceAfter: new Prisma.Decimal(125.5),
        }) as Record<string, unknown>,
      });
    });

    it('rejects non-positive amounts before touching the database', async () => {
      await expect(
        service.credit({
          organizationId: ORG,
          amount: 0,
          category: MutationCategory.PAYMENT_SETTLEMENT,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(client.$transaction).not.toHaveBeenCalled();
    });

    it('rejects amounts with more than 2 decimal places', async () => {
      await expect(
        service.credit({
          organizationId: ORG,
          amount: 1.005,
          category: MutationCategory.PAYMENT_SETTLEMENT,
        }),
      ).rejects.toThrow('at most 2 decimal places');
      expect(client.$transaction).not.toHaveBeenCalled();
    });

    it('uses the provided transaction client instead of opening a new one', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(0));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(0));

      await service.credit(
        {
          organizationId: ORG,
          amount: 10,
          category: MutationCategory.PAYMENT_SETTLEMENT,
        },
        client as unknown as Prisma.TransactionClient,
      );

      expect(client.$transaction).not.toHaveBeenCalled();
      expect(client.balanceMutation.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('debit', () => {
    it('decrements available balance and records a DEBIT mutation', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(100));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(100));

      const after = await service.debit({
        organizationId: ORG,
        amount: 40,
        category: MutationCategory.PAYOUT,
      });

      expect(after.toString()).toBe('60');
      expect(client.balanceMutation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: MutationType.DEBIT,
          balanceBefore: new Prisma.Decimal(100),
          balanceAfter: new Prisma.Decimal(60),
        }) as Record<string, unknown>,
      });
    });

    it('throws and writes nothing when available balance is insufficient', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(10));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(10));

      await expect(
        service.debit({
          organizationId: ORG,
          amount: 11,
          category: MutationCategory.PAYOUT,
        }),
      ).rejects.toThrow('Insufficient available balance');
      expect(client.tenantBalance.update).not.toHaveBeenCalled();
      expect(client.balanceMutation.create).not.toHaveBeenCalled();
    });
  });

  describe('lockBalance', () => {
    it('moves funds from available to locked', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(100));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(100));

      await service.lockBalance(ORG, 30);

      expect(client.tenantBalance.update).toHaveBeenCalledWith({
        where: { id: 'bal-1' },
        data: {
          availableBalance: { decrement: new Prisma.Decimal(30) },
          lockedBalance: { increment: new Prisma.Decimal(30) },
        },
      });
    });

    it('throws when available balance cannot cover the lock', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(5));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(5));

      await expect(service.lockBalance(ORG, 6)).rejects.toThrow(
        'Insufficient available balance',
      );
      expect(client.tenantBalance.update).not.toHaveBeenCalled();
    });
  });

  describe('unlockBalance', () => {
    it('moves funds from locked back to available', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(0, 50));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(0, 50));

      await service.unlockBalance(ORG, 20);

      expect(client.tenantBalance.update).toHaveBeenCalledWith({
        where: { id: 'bal-1' },
        data: {
          availableBalance: { increment: new Prisma.Decimal(20) },
          lockedBalance: { decrement: new Prisma.Decimal(20) },
        },
      });
    });

    it('throws when locked balance cannot cover the unlock', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(0, 5));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(0, 5));

      await expect(service.unlockBalance(ORG, 6)).rejects.toThrow(
        'Insufficient locked balance',
      );
      expect(client.tenantBalance.update).not.toHaveBeenCalled();
    });
  });

  describe('completePayoutDebit', () => {
    it('decrements locked balance and records a PAYOUT debit with total balance before/after', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(70, 30));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(balance(70, 30));

      await service.completePayoutDebit({
        organizationId: ORG,
        amount: 30,
        referenceId: 'PO-1',
      });

      expect(client.tenantBalance.update).toHaveBeenCalledWith({
        where: { id: 'bal-1' },
        data: { lockedBalance: { decrement: new Prisma.Decimal(30) } },
      });
      expect(client.balanceMutation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: MutationType.DEBIT,
          category: MutationCategory.PAYOUT,
          referenceId: 'PO-1',
          balanceBefore: new Prisma.Decimal(100),
          balanceAfter: new Prisma.Decimal(70),
        }) as Record<string, unknown>,
      });
    });

    it('throws when locked balance is smaller than the payout amount', async () => {
      client.tenantBalance.upsert.mockResolvedValue(balance(100, 10));
      client.tenantBalance.findUniqueOrThrow.mockResolvedValue(
        balance(100, 10),
      );

      await expect(
        service.completePayoutDebit({
          organizationId: ORG,
          amount: 20,
          referenceId: 'PO-2',
        }),
      ).rejects.toThrow('Insufficient locked balance');
      expect(client.balanceMutation.create).not.toHaveBeenCalled();
    });
  });

  describe('getMutations', () => {
    it('paginates with skip/take and returns the total count', async () => {
      client.balanceMutation.findMany.mockResolvedValue([{ id: 'm1' }]);
      client.balanceMutation.count.mockResolvedValue(7);
      client.$transaction.mockResolvedValue([[{ id: 'm1' }], 7]);

      const result = await service.getMutations(ORG, 3, 2);

      expect(client.balanceMutation.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 4,
        take: 2,
      });
      expect(result).toEqual({
        items: [{ id: 'm1' }],
        total: 7,
        page: 3,
        limit: 2,
      });
    });
  });
});
