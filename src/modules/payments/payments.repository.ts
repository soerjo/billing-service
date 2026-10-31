import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  PaymentChannel,
  PaymentProvider,
  PaymentStatus,
  PaymentTransaction,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTransaction(
    data: {
      orderId: string;
      organizationId?: string;
      amount: number | Prisma.Decimal;
      currency?: string;
      description?: string;
      metadata?: Prisma.InputJsonValue;
      midtransOrderId: string;
      provider?: PaymentProvider;
      channel?: PaymentChannel;
      status?: PaymentStatus;
      snapToken?: string;
      snapRedirectUrl?: string;
      vaBank?: string;
      vaNumber?: string;
      vaExpiryTime?: Date;
      requestPayload?: Prisma.InputJsonValue;
      rawResponse?: Prisma.InputJsonValue;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.paymentTransaction.create({
      data: {
        orderId: data.orderId,
        organizationId: data.organizationId,
        amount: data.amount,
        currency: data.currency || 'IDR',
        description: data.description,
        metadata: data.metadata,
        provider: data.provider || PaymentProvider.MIDTRANS,
        channel: data.channel || PaymentChannel.SNAP_ALL,
        status: data.status || PaymentStatus.PENDING,
        midtransOrderId: data.midtransOrderId,
        snapToken: data.snapToken,
        snapRedirectUrl: data.snapRedirectUrl,
        vaBank: data.vaBank,
        vaNumber: data.vaNumber,
        vaExpiryTime: data.vaExpiryTime,
        requestPayload: data.requestPayload,
        rawResponse: data.rawResponse,
      },
    });
  }

  async findByOrderId(orderId: string) {
    return this.prisma.paymentTransaction.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLatestByOrderId(orderId: string) {
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });

    if (!transaction) {
      throw new NotFoundException(
        `No payment transaction found for order ${orderId}`,
      );
    }

    return transaction;
  }

  async findByMidtransOrderId(midtransOrderId: string) {
    return this.prisma.paymentTransaction.findUnique({
      where: { midtransOrderId },
    });
  }

  async findSuccessfulByOrderId(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.paymentTransaction.findFirst({
      where: {
        orderId,
        status: { in: ['SETTLEMENT', 'CAPTURE'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findPendingByOrderId(orderId: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return client.paymentTransaction.findFirst({
      where: { orderId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findCurrentByOrderId(orderId: string) {
    const successful = await this.findSuccessfulByOrderId(orderId);
    if (successful) {
      return successful;
    }

    return this.findLatestByOrderId(orderId);
  }

  async findTransactionsForSync(
    orderId: string,
  ): Promise<PaymentTransaction[]> {
    const txs = await this.prisma.paymentTransaction.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });

    if (txs.length === 0) {
      throw new NotFoundException(
        `No payment transaction found for order '${orderId}'`,
      );
    }

    const unsettled = txs.filter(
      (tx) => !['SETTLEMENT', 'CAPTURE'].includes(tx.status),
    );

    return unsettled.length > 0 ? unsettled : [txs[0]];
  }

  async findTransactionsForBatchSync(
    orderIds?: string[],
  ): Promise<PaymentTransaction[]> {
    if (!orderIds || orderIds.length === 0) {
      return this.findUnsettledTransactions();
    }

    const txs = await this.prisma.paymentTransaction.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { createdAt: 'desc' },
    });

    const unsettled = txs.filter(
      (tx) => !['SETTLEMENT', 'CAPTURE'].includes(tx.status),
    );

    const coveredOrders = new Set(unsettled.map((tx) => tx.orderId));
    const result = [...unsettled];

    txs.forEach((tx) => {
      if (!coveredOrders.has(tx.orderId)) {
        result.push(tx);
        coveredOrders.add(tx.orderId);
      }
    });

    return result;
  }

  async findUnsettledTransactions(limit?: number) {
    return this.prisma.paymentTransaction.findMany({
      where: {
        status: {
          notIn: ['SETTLEMENT', 'CAPTURE'],
        },
      },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });
  }

  async findPendingTransactions(limit?: number) {
    return this.findUnsettledTransactions(limit);
  }

  async listOrders(options: {
    status?: PaymentStatus;
    startDate: Date;
    endDate: Date;
    page: number;
    pageSize: number;
  }) {
    const statusFilter = options.status
      ? Prisma.sql`AND ranked.status = ${options.status}::"PaymentStatus"`
      : Prisma.empty;
    const offset = (options.page - 1) * options.pageSize;

    return this.prisma.$queryRaw<
      Array<{
        orderId: string;
        id: string;
        midtransOrderId: string;
        amount: Prisma.Decimal;
        currency: string;
        channel: PaymentChannel;
        status: PaymentStatus;
        paidAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        totalCount: bigint;
      }>
    >(Prisma.sql`
      WITH candidate_orders AS (
        SELECT DISTINCT pt.order_id
        FROM payment_transactions pt
        WHERE pt.created_at >= ${options.startDate}
          AND pt.created_at < ${options.endDate}
      ), ranked AS (
        SELECT
          pt.order_id AS "orderId",
          pt.id,
          pt.midtrans_order_id AS "midtransOrderId",
          pt.gross_amount AS amount,
          pt.currency,
          pt.channel,
          pt.status,
          pt.paid_at AS "paidAt",
          pt.created_at AS "createdAt",
          pt.updated_at AS "updatedAt",
          ROW_NUMBER() OVER (
            PARTITION BY pt.order_id
            ORDER BY
              CASE
                WHEN pt.status IN ('SETTLEMENT', 'CAPTURE') THEN 0
                ELSE 1
              END,
              pt.created_at DESC,
              pt.id DESC
          ) AS row_number
        FROM payment_transactions pt
        INNER JOIN candidate_orders candidate
          ON candidate.order_id = pt.order_id
      ), filtered AS (
        SELECT ranked.*
        FROM ranked
        WHERE ranked.row_number = 1
          ${statusFilter}
      )
      SELECT
        filtered."orderId",
        filtered.id,
        filtered."midtransOrderId",
        filtered.amount,
        filtered.currency,
        filtered.channel,
        filtered.status,
        filtered."paidAt",
        filtered."createdAt",
        filtered."updatedAt",
        COUNT(*) OVER() AS "totalCount"
      FROM filtered
      ORDER BY filtered."createdAt" DESC, filtered.id DESC
      OFFSET ${offset}
      LIMIT ${options.pageSize}
    `);
  }

  async withOrderLock<T>(
    orderId: string,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${orderId}, 0))`;
        return callback(tx);
      },
      {
        maxWait: 5000,
        timeout: 20000,
      },
    );
  }

  async lockStatusForUpdate(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentStatus> {
    const [row] = await tx.$queryRaw<{ status: PaymentStatus }[]>`
      SELECT status FROM payment_transactions WHERE id = ${id} FOR UPDATE
    `;
    if (!row) {
      throw new NotFoundException(`Payment transaction '${id}' not found`);
    }
    return row.status;
  }

  async updateTransactionStatus(
    id: string,
    status: PaymentStatus,
    data?: {
      midtransTransactionId?: string;
      signatureKey?: string;
      rawResponse?: Prisma.InputJsonValue;
      paidAt?: Date;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.paymentTransaction.update({
      where: { id },
      data: {
        status,
        midtransTransactionId: data?.midtransTransactionId,
        signatureKey: data?.signatureKey,
        rawResponse: data?.rawResponse,
        paidAt: data?.paidAt,
      },
    });
  }
}
