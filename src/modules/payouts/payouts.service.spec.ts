import { BadRequestException, ConflictException } from '@nestjs/common';
import { PayoutStatus, Prisma } from '@prisma/client';
import { PayoutsService } from './payouts.service.js';
import { PayoutsRepository } from './payouts.repository.js';
import { TenantBalanceService } from '../tenant-balance/tenant-balance.service.js';

const TX = { tag: 'tx' } as unknown as Prisma.TransactionClient;

interface RepositoryMock {
  transaction: jest.Mock;
  create: jest.Mock;
  findById: jest.Mock;
  updateStatusIf: jest.Mock;
  findManyByOrganization: jest.Mock;
}

interface TenantBalanceMock {
  lockBalance: jest.Mock;
  unlockBalance: jest.Mock;
  completePayoutDebit: jest.Mock;
}

function payout(status: PayoutStatus) {
  return {
    id: 'po-1',
    organizationId: 'org-1',
    amount: new Prisma.Decimal(50),
    referenceNo: 'PO-REF-1',
    status,
  };
}

describe('PayoutsService', () => {
  let repo: RepositoryMock;
  let balance: TenantBalanceMock;
  let service: PayoutsService;

  beforeEach(() => {
    repo = {
      // Runs the callback with a stable transaction client, like prisma.$transaction.
      transaction: jest.fn(
        async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          fn(TX),
      ),
      create: jest.fn((data: unknown) => ({
        id: 'po-new',
        ...(data as object),
      })),
      findById: jest.fn(),
      updateStatusIf: jest.fn(),
      findManyByOrganization: jest.fn(),
    };
    balance = {
      lockBalance: jest.fn().mockResolvedValue(undefined),
      unlockBalance: jest.fn().mockResolvedValue(undefined),
      completePayoutDebit: jest.fn().mockResolvedValue(undefined),
    };
    // Partial mocks: only the methods PayoutsService calls are provided.
    service = new PayoutsService(
      repo as unknown as PayoutsRepository,
      balance as unknown as TenantBalanceService,
    );
  });

  describe('requestPayout', () => {
    it('locks the balance and creates a PENDING payout in one transaction', async () => {
      const result = await service.requestPayout({
        organizationId: 'org-1',
        amount: 75,
        bankCode: 'bca',
        bankAccountNumber: '123',
        bankAccountName: 'Owner',
      });

      expect(repo.transaction).toHaveBeenCalledTimes(1);
      expect(balance.lockBalance).toHaveBeenCalledWith('org-1', 75, TX);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          amount: new Prisma.Decimal(75),
          bankCode: 'bca',
          bankAccountNumber: '123',
          bankAccountName: 'Owner',
          status: PayoutStatus.PENDING,
          referenceNo: expect.stringMatching(/^PO-\d+-[0-9a-f]{8}$/) as string,
        }),
        TX,
      );
      expect(result).toMatchObject({ status: PayoutStatus.PENDING });
    });

    it('does not create a payout when locking fails', async () => {
      balance.lockBalance.mockRejectedValue(
        new BadRequestException('Insufficient available balance'),
      );

      await expect(
        service.requestPayout({
          organizationId: 'org-1',
          amount: 75,
          bankCode: 'bca',
          bankAccountNumber: '123',
          bankAccountName: 'Owner',
        }),
      ).rejects.toThrow('Insufficient available balance');
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('updatePayoutStatus', () => {
    it('returns the payout unchanged when the status is already the target', async () => {
      repo.findById.mockResolvedValue(payout(PayoutStatus.APPROVED));

      const result = await service.updatePayoutStatus(
        'po-1',
        PayoutStatus.APPROVED,
      );

      expect(result).toMatchObject({ status: PayoutStatus.APPROVED });
      expect(repo.updateStatusIf).not.toHaveBeenCalled();
      expect(balance.completePayoutDebit).not.toHaveBeenCalled();
      expect(balance.unlockBalance).not.toHaveBeenCalled();
    });

    it('rejects transitions out of a terminal status with 409', async () => {
      repo.findById.mockResolvedValue(payout(PayoutStatus.COMPLETED));

      await expect(
        service.updatePayoutStatus('po-1', PayoutStatus.REJECTED),
      ).rejects.toThrow(ConflictException);
      expect(repo.updateStatusIf).not.toHaveBeenCalled();
    });

    it('rejects moving a payout back to PENDING', async () => {
      repo.findById.mockResolvedValue(payout(PayoutStatus.APPROVED));

      await expect(
        service.updatePayoutStatus('po-1', PayoutStatus.PENDING),
      ).rejects.toThrow('cannot be moved back to PENDING');
      expect(repo.updateStatusIf).not.toHaveBeenCalled();
    });

    it('settles locked funds with completePayoutDebit on COMPLETED', async () => {
      repo.findById.mockResolvedValue(payout(PayoutStatus.APPROVED));
      repo.updateStatusIf.mockResolvedValue({
        ...payout(PayoutStatus.COMPLETED),
      });

      await service.updatePayoutStatus('po-1', PayoutStatus.COMPLETED);

      expect(repo.updateStatusIf).toHaveBeenCalledWith(
        'po-1',
        [PayoutStatus.APPROVED],
        expect.objectContaining({
          status: PayoutStatus.COMPLETED,
          completedAt: expect.any(Date) as Date,
        }),
        TX,
      );
      expect(balance.completePayoutDebit).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          amount: new Prisma.Decimal(50),
          referenceId: 'PO-REF-1',
          description: 'Payout completed',
        },
        TX,
      );
      expect(balance.unlockBalance).not.toHaveBeenCalled();
    });

    it.each([PayoutStatus.REJECTED, PayoutStatus.CANCELLED])(
      'releases locked funds back to available on %s',
      async (status) => {
        repo.findById.mockResolvedValue(payout(PayoutStatus.PENDING));
        repo.updateStatusIf.mockResolvedValue(payout(status));

        await service.updatePayoutStatus('po-1', status, 'bank rejected');

        expect(repo.updateStatusIf).toHaveBeenCalledWith(
          'po-1',
          [PayoutStatus.PENDING],
          expect.objectContaining({
            status,
            rejectedReason: 'bank rejected',
          }),
          TX,
        );
        expect(balance.unlockBalance).toHaveBeenCalledWith(
          'org-1',
          new Prisma.Decimal(50),
          TX,
        );
        expect(balance.completePayoutDebit).not.toHaveBeenCalled();
      },
    );

    it('sets approvedAt when moving to APPROVED without touching balances', async () => {
      repo.findById.mockResolvedValue(payout(PayoutStatus.PENDING));
      repo.updateStatusIf.mockResolvedValue(payout(PayoutStatus.APPROVED));

      await service.updatePayoutStatus('po-1', PayoutStatus.APPROVED);

      expect(repo.updateStatusIf).toHaveBeenCalledWith(
        'po-1',
        [PayoutStatus.PENDING],
        expect.objectContaining({
          status: PayoutStatus.APPROVED,
          approvedAt: expect.any(Date) as Date,
        }),
        TX,
      );
      expect(balance.completePayoutDebit).not.toHaveBeenCalled();
      expect(balance.unlockBalance).not.toHaveBeenCalled();
    });

    it('throws 409 and moves no funds when the compare-and-set loses a race', async () => {
      repo.findById.mockResolvedValue(payout(PayoutStatus.PENDING));
      repo.updateStatusIf.mockResolvedValue(null);

      await expect(
        service.updatePayoutStatus('po-1', PayoutStatus.CANCELLED),
      ).rejects.toThrow(ConflictException);
      expect(balance.unlockBalance).not.toHaveBeenCalled();
    });
  });

  describe('listPayouts and getPayoutById', () => {
    it('delegates listing to the repository with the same params', async () => {
      const params = {
        organizationId: 'org-1',
        status: PayoutStatus.PENDING,
        page: 2,
        limit: 10,
      };
      repo.findManyByOrganization.mockResolvedValue({ items: [] });

      await service.listPayouts(params);

      expect(repo.findManyByOrganization).toHaveBeenCalledWith(params);
    });

    it('delegates lookup by id to the repository', async () => {
      repo.findById.mockResolvedValue(payout(PayoutStatus.PENDING));

      const result = await service.getPayoutById('po-1');

      expect(repo.findById).toHaveBeenCalledWith('po-1');
      expect(result).toMatchObject({ id: 'po-1' });
    });
  });
});
