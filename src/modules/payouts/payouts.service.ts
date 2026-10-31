import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PayoutStatus, Prisma } from '@prisma/client';
import { TenantBalanceService } from '../tenant-balance/tenant-balance.service.js';
import { ListPayoutsParams, PayoutsRepository } from './payouts.repository.js';

export interface RequestPayoutInput {
  organizationId: string;
  amount: number | Prisma.Decimal;
  bankCode: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

const TERMINAL_STATUSES: PayoutStatus[] = [
  PayoutStatus.COMPLETED,
  PayoutStatus.REJECTED,
  PayoutStatus.CANCELLED,
];

@Injectable()
export class PayoutsService {
  constructor(
    private readonly payoutsRepository: PayoutsRepository,
    private readonly tenantBalanceService: TenantBalanceService,
  ) {}

  /**
   * Moves the requested amount from availableBalance to lockedBalance and
   * records a PENDING payout. Both writes share one transaction.
   */
  async requestPayout(input: RequestPayoutInput) {
    return this.payoutsRepository.transaction(async (tx) => {
      await this.tenantBalanceService.lockBalance(
        input.organizationId,
        input.amount,
        tx,
      );

      return this.payoutsRepository.create(
        {
          organizationId: input.organizationId,
          amount: new Prisma.Decimal(input.amount),
          bankCode: input.bankCode,
          bankAccountNumber: input.bankAccountNumber,
          bankAccountName: input.bankAccountName,
          referenceNo: `PO-${Date.now()}-${randomBytes(4).toString('hex')}`,
          status: PayoutStatus.PENDING,
        },
        tx,
      );
    });
  }

  async listPayouts(params: ListPayoutsParams) {
    return this.payoutsRepository.findManyByOrganization(params);
  }

  async getPayoutById(id: string) {
    return this.payoutsRepository.findById(id);
  }

  /**
   * Applies a status transition. Funds are settled or released in the same
   * transaction as the status change. The status update is a compare-and-set
   * on the status read here, so a concurrent transition fails with 409 instead
   * of applying its balance effect twice.
   */
  async updatePayoutStatus(
    id: string,
    newStatus: PayoutStatus,
    reason?: string,
  ) {
    return this.payoutsRepository.transaction(async (tx) => {
      const payout = await this.payoutsRepository.findById(id, tx);

      if (payout.status === newStatus) {
        return payout;
      }
      if (TERMINAL_STATUSES.includes(payout.status)) {
        throw new ConflictException(
          `Payout ${id} is already ${payout.status} and cannot change`,
        );
      }
      if (newStatus === PayoutStatus.PENDING) {
        throw new BadRequestException('Payout cannot be moved back to PENDING');
      }

      const now = new Date();
      const updated = await this.payoutsRepository.updateStatusIf(
        id,
        [payout.status],
        {
          status: newStatus,
          ...(newStatus === PayoutStatus.APPROVED && { approvedAt: now }),
          ...(newStatus === PayoutStatus.COMPLETED && { completedAt: now }),
          ...((newStatus === PayoutStatus.REJECTED ||
            newStatus === PayoutStatus.CANCELLED) && {
            rejectedReason: reason,
          }),
        },
        tx,
      );
      if (!updated) {
        throw new ConflictException(
          `Payout ${id} was changed concurrently; retry`,
        );
      }

      if (newStatus === PayoutStatus.COMPLETED) {
        await this.tenantBalanceService.completePayoutDebit(
          {
            organizationId: payout.organizationId,
            amount: payout.amount,
            referenceId: payout.referenceNo,
            description: 'Payout completed',
          },
          tx,
        );
      } else if (
        newStatus === PayoutStatus.REJECTED ||
        newStatus === PayoutStatus.CANCELLED
      ) {
        await this.tenantBalanceService.unlockBalance(
          payout.organizationId,
          payout.amount,
          tx,
        );
      }

      return updated;
    });
  }
}
