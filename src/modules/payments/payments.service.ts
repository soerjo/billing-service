import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PaymentsRepository } from './payments.repository.js';
import { MidtransService } from '../midtrans/midtrans.service.js';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { CreateSnapPaymentDto } from './dto/create-snap-payment.dto.js';
import { CreateQrPaymentDto } from './dto/create-qr-payment.dto.js';
import { CreateVaPaymentDto } from './dto/create-va-payment.dto.js';
import { SyncPaymentsDto } from './dto/sync-payments.dto.js';
import { ListPaymentOrdersDto } from './dto/list-payment-orders.dto.js';
import {
  PaymentChannel,
  PaymentStatus,
  PaymentTransaction,
  Prisma,
} from '@prisma/client';

export interface SyncPaymentResult {
  orderId: string;
  transactionId: string;
  midtransOrderId: string;
  status: string;
  previousStatus: string;
  statusChanged: boolean;
  paymentType?: string;
  paidAt?: Date;
  synced: boolean;
  message?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly midtransService: MidtransService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly outboxService: OutboxService,
  ) {}

  async createSnapPayment(dto: CreateSnapPaymentDto) {
    return this.paymentsRepository.withOrderLock(dto.orderId, async (tx) => {
      await this.ensureOrderCanBePaid(dto.orderId, tx);
      await this.ensureNoActiveAttempt(dto.orderId, tx);

      const txSuffix = Date.now().toString().slice(-6);
      const midtransOrderId = `${dto.orderId}-TX${txSuffix}`;
      const amount = Math.round(Number(dto.amount));
      const snapResult = await this.midtransService.createSnapTransaction({
        orderId: midtransOrderId,
        grossAmount: amount,
        customerDetails: {
          first_name: dto.customerName,
          email: dto.customerEmail,
          phone: dto.customerPhone,
        },
        itemDetails: [
          {
            id: dto.orderId,
            name: dto.description || `Order ${dto.orderId}`,
            price: amount,
            quantity: 1,
          },
        ],
      });

      const transaction = await this.paymentsRepository.createTransaction(
        {
          orderId: dto.orderId,
          amount: new Prisma.Decimal(amount),
          currency: dto.currency || 'IDR',
          description: dto.description,
          metadata: dto.metadata as unknown as Prisma.InputJsonValue,
          midtransOrderId,
          channel: dto.channel || PaymentChannel.SNAP_ALL,
          snapToken: snapResult.token,
          snapRedirectUrl: snapResult.redirect_url,
          requestPayload:
            snapResult.requestPayload as unknown as Prisma.InputJsonValue,
          rawResponse:
            snapResult.rawResponse as unknown as Prisma.InputJsonValue,
          status: PaymentStatus.PENDING,
        },
        tx,
      );

      return {
        orderId: dto.orderId,
        transactionId: transaction.id,
        midtransOrderId,
        amount,
        currency: dto.currency || 'IDR',
        snapToken: snapResult.token,
        snapRedirectUrl: snapResult.redirect_url,
        status: 'PENDING',
      };
    });
  }

  async createQrPayment(dto: CreateQrPaymentDto) {
    return this.paymentsRepository.withOrderLock(dto.orderId, async (tx) => {
      await this.ensureOrderCanBePaid(dto.orderId, tx);
      await this.ensureNoActiveAttempt(dto.orderId, tx);

      const txSuffix = Date.now().toString().slice(-6);
      const midtransOrderId = `${dto.orderId}-QR${txSuffix}`;
      const amount = Math.round(Number(dto.amount));
      const qrResult = await this.midtransService.createQrTransaction({
        orderId: midtransOrderId,
        grossAmount: amount,
        customerDetails: {
          first_name: dto.customerName,
          email: dto.customerEmail,
        },
        itemDetails: [
          {
            id: dto.orderId,
            name: dto.description || `Order ${dto.orderId}`,
            price: amount,
            quantity: 1,
          },
        ],
      });

      const transaction = await this.paymentsRepository.createTransaction(
        {
          orderId: dto.orderId,
          amount: new Prisma.Decimal(amount),
          currency: dto.currency || 'IDR',
          description: dto.description,
          metadata: dto.metadata as unknown as Prisma.InputJsonValue,
          midtransOrderId,
          channel: PaymentChannel.QRIS,
          requestPayload:
            qrResult.requestPayload as unknown as Prisma.InputJsonValue,
          rawResponse: qrResult.rawResponse as unknown as Prisma.InputJsonValue,
          status: PaymentStatus.PENDING,
        },
        tx,
      );

      return {
        orderId: dto.orderId,
        transactionId: transaction.id,
        midtransOrderId,
        amount,
        currency: dto.currency || 'IDR',
        qrString: qrResult.qrString,
        qrImageUrl: qrResult.qrImageUrl,
        expiresAt: qrResult.expiryTime,
        status: qrResult.transactionStatus
          ? qrResult.transactionStatus.toUpperCase()
          : PaymentStatus.PENDING,
      };
    });
  }

  async createVirtualAccountPayment(dto: CreateVaPaymentDto) {
    return this.paymentsRepository.withOrderLock(dto.orderId, async (tx) => {
      await this.ensureOrderCanBePaid(dto.orderId, tx);
      await this.ensureNoActiveAttempt(dto.orderId, tx);
      const bank = await this.paymentMethodsService.findEnabledBank(dto.bank);
      if (!bank) {
        throw new BadRequestException(
          `Virtual account bank '${dto.bank}' is not available`,
        );
      }

      const txSuffix = Date.now().toString().slice(-6);
      const midtransOrderId = `${dto.orderId}-VA${txSuffix}`;
      const amount = Math.round(Number(dto.amount));
      const virtualAccount = await this.midtransService.createVirtualAccount({
        orderId: midtransOrderId,
        grossAmount: amount,
        bank: dto.bank,
      });
      const vaExpiryTime = virtualAccount.expiryTime
        ? new Date(virtualAccount.expiryTime)
        : undefined;
      if (vaExpiryTime && Number.isNaN(vaExpiryTime.getTime())) {
        throw new BadGatewayException(
          'Midtrans returned an invalid virtual account expiry time',
        );
      }

      const transaction = await this.paymentsRepository.createTransaction(
        {
          orderId: dto.orderId,
          amount: new Prisma.Decimal(amount),
          currency: dto.currency || 'IDR',
          description: dto.description,
          metadata: dto.metadata as unknown as Prisma.InputJsonValue,
          midtransOrderId,
          channel: PaymentChannel.BANK_TRANSFER,
          vaBank: virtualAccount.bank,
          vaNumber: virtualAccount.vaNumber,
          vaExpiryTime,
          requestPayload:
            virtualAccount.requestPayload as unknown as Prisma.InputJsonValue,
          rawResponse:
            virtualAccount.rawResponse as unknown as Prisma.InputJsonValue,
          status: PaymentStatus.PENDING,
        },
        tx,
      );

      return {
        orderId: dto.orderId,
        transactionId: transaction.id,
        midtransOrderId,
        bank: virtualAccount.bank,
        vaNumber: virtualAccount.vaNumber,
        amount,
        currency: dto.currency || 'IDR',
        expiryTime: virtualAccount.expiryTime,
        status: virtualAccount.transactionStatus || 'PENDING',
      };
    });
  }

  async getPaymentStatus(orderId: string) {
    const latest = await this.paymentsRepository.findCurrentByOrderId(orderId);
    return {
      orderId: latest.orderId,
      transactionId: latest.id,
      midtransOrderId: latest.midtransOrderId,
      status: latest.status,
      amount: Number(latest.amount),
      currency: latest.currency,
      channel: latest.channel,
      paidAt: latest.paidAt,
      createdAt: latest.createdAt,
    };
  }

  async getPaymentTransactions(orderId: string) {
    return this.paymentsRepository.findByOrderId(orderId);
  }

  async listPaymentOrders(query: ListPaymentOrdersDto) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startDate >= endDate
    ) {
      throw new BadRequestException('endDate must be later than startDate');
    }

    const rows = await this.paymentsRepository.listOrders({
      status: query.status,
      startDate,
      endDate,
      page: query.page,
      pageSize: query.pageSize,
    });
    const data = rows.map((row) => ({
      orderId: row.orderId,
      transactionId: row.id,
      midtransOrderId: row.midtransOrderId,
      amount: Number(row.amount),
      currency: row.currency,
      channel: row.channel,
      status: row.status,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total: rows.length > 0 ? Number(rows[0].totalCount) : 0,
    };
  }
  async syncPaymentStatus(orderId: string) {
    const transactions =
      await this.paymentsRepository.findTransactionsForSync(orderId);
    const results = await Promise.all(
      transactions.map((tx) => this.syncTransaction(tx)),
    );
    return results.find((r) => r.statusChanged) || results[0];
  }

  async syncBatch(dto?: SyncPaymentsDto) {
    const transactionsToSync =
      await this.paymentsRepository.findTransactionsForBatchSync(dto?.orderIds);

    const results = await Promise.all(
      transactionsToSync.map((tx) => this.syncTransaction(tx)),
    );

    return {
      total: results.length,
      updated: results.filter((r) => r.statusChanged).length,
      results,
    };
  }

  private async syncTransaction(
    transaction: PaymentTransaction,
  ): Promise<SyncPaymentResult> {
    const midtransStatus = await this.midtransService.getTransactionStatus(
      transaction.midtransOrderId,
    );

    if (midtransStatus?.statusCode !== '200') {
      return {
        orderId: transaction.orderId,
        transactionId: transaction.id,
        midtransOrderId: transaction.midtransOrderId,
        status: transaction.status,
        previousStatus: transaction.status,
        statusChanged: false,
        synced: false,
        message: 'Transaction not found in Midtrans',
      };
    }

    const normalizedStatus =
      midtransStatus.transactionStatus.toUpperCase() as PaymentStatus;
    const statusChanged = normalizedStatus !== transaction.status.toUpperCase();
    const isPaid =
      midtransStatus.transactionStatus === 'settlement' ||
      (midtransStatus.transactionStatus === 'capture' &&
        midtransStatus.fraudStatus === 'accept');
    const isFailed =
      midtransStatus.transactionStatus === 'deny' ||
      midtransStatus.transactionStatus === 'cancel' ||
      midtransStatus.transactionStatus === 'expire';

    const paidAt = isPaid
      ? midtransStatus.settlementTime
        ? new Date(midtransStatus.settlementTime)
        : new Date()
      : undefined;

    if (statusChanged) {
      await this.paymentsRepository.updateTransactionStatus(
        transaction.id,
        normalizedStatus,
        {
          midtransTransactionId: midtransStatus.transactionId,
          rawResponse:
            midtransStatus.rawResponse as unknown as Prisma.InputJsonValue,
          paidAt: paidAt ?? transaction.paidAt ?? undefined,
        },
      );

      if (isPaid) {
        await this.outboxService.emit(
          'PAYMENT',
          transaction.orderId,
          'PAYMENT_COMPLETED',
          {
            eventId: midtransStatus.transactionId || `sync-${Date.now()}`,
            eventType: 'PAYMENT_COMPLETED',
            orderId: transaction.orderId,
            transactionId: transaction.id,
            midtransOrderId: transaction.midtransOrderId,
            midtransTransactionId: midtransStatus.transactionId,
            amount: Number(transaction.amount),
            currency: transaction.currency,
            paymentType: midtransStatus.paymentType || transaction.channel,
            settledAt: (paidAt || new Date()).toISOString(),
            metadata: transaction.metadata,
            source: 'STATUS_SYNC',
          },
        );
        this.logger.log(
          `Synced payment for order ${transaction.orderId}: status updated to ${normalizedStatus} and PAYMENT_COMPLETED event emitted`,
        );
      } else if (isFailed) {
        await this.outboxService.emit(
          'PAYMENT',
          transaction.orderId,
          'PAYMENT_FAILED',
          {
            eventId: midtransStatus.transactionId || `sync-${Date.now()}`,
            eventType: 'PAYMENT_FAILED',
            orderId: transaction.orderId,
            transactionId: transaction.id,
            midtransOrderId: transaction.midtransOrderId,
            midtransTransactionId: midtransStatus.transactionId,
            amount: Number(transaction.amount),
            currency: transaction.currency,
            paymentType: midtransStatus.paymentType || transaction.channel,
            status: normalizedStatus,
            metadata: transaction.metadata,
            source: 'STATUS_SYNC',
          },
        );
        this.logger.warn(
          `Synced payment for order ${transaction.orderId}: status updated to ${normalizedStatus} and PAYMENT_FAILED event emitted`,
        );
      }
    }

    return {
      orderId: transaction.orderId,
      transactionId: transaction.id,
      midtransOrderId: transaction.midtransOrderId,
      status: normalizedStatus,
      previousStatus: transaction.status,
      statusChanged,
      paymentType: midtransStatus.paymentType || transaction.channel,
      paidAt: paidAt ?? transaction.paidAt ?? undefined,
      synced: true,
    };
  }

  private async ensureOrderCanBePaid(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const successful = await this.paymentsRepository.findSuccessfulByOrderId(
      orderId,
      tx,
    );
    if (successful) {
      throw new ConflictException(
        `Order ${orderId} already has a successful payment`,
      );
    }
  }

  private async ensureNoActiveAttempt(
    orderId: string,
    tx: Prisma.TransactionClient,
  ) {
    const active = await this.paymentsRepository.findPendingByOrderId(
      orderId,
      tx,
    );
    if (active) {
      throw new ConflictException(
        `Order ${orderId} already has an active payment attempt`,
      );
    }
  }
}
