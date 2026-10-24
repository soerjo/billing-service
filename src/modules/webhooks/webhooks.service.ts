import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MidtransService } from '../midtrans/midtrans.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PaymentStatus, Prisma } from '@prisma/client';
import { MidtransWebhookDto } from './dto/midtrans-webhook.dto.js';

export type MidtransWebhookPayload = MidtransWebhookDto;
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly midtransService: MidtransService,
    private readonly outboxService: OutboxService,
  ) {}

  async handleMidtransWebhook(payload: MidtransWebhookPayload) {
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_id,
      transaction_status,
      fraud_status,
    } = payload;

    // 1. Signature validation
    const isValidSignature = this.midtransService.verifySignatureKey({
      orderId: order_id,
      statusCode: status_code,
      grossAmount: gross_amount,
      signatureKey: signature_key,
    });

    if (!isValidSignature) {
      this.logger.warn(`Invalid signature for webhook order ${order_id}`);
      throw new BadRequestException('Invalid signature');
    }

    const eventId = `${transaction_id}:${status_code}:${transaction_status}`;

    // 2. Idempotency check via WebhookEvent
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent) {
      this.logger.log(`Webhook event ${eventId} already processed, skipping`);
      return { status: 'ALREADY_PROCESSED', eventId };
    }

    return this.prisma.$transaction(async (tx) => {
      // Record webhook event for idempotency
      await tx.webhookEvent.create({
        data: {
          provider: 'MIDTRANS',
          eventId,
          orderId: order_id,
          signatureKey: signature_key,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });

      // Find transaction by Midtrans order id
      const transaction = await tx.paymentTransaction.findUnique({
        where: { midtransOrderId: order_id },
      });

      if (!transaction) {
        this.logger.warn(`No payment transaction found for order ${order_id}`);
        return { status: 'TRANSACTION_NOT_FOUND', orderId: order_id };
      }

      const normalizedStatus =
        transaction_status.toUpperCase() as PaymentStatus;
      const isPaid =
        transaction_status === 'settlement' ||
        (transaction_status === 'capture' && fraud_status === 'accept');
      const isFailed =
        transaction_status === 'deny' ||
        transaction_status === 'cancel' ||
        transaction_status === 'expire';
      const wasPaid = ['SETTLEMENT', 'CAPTURE'].includes(
        transaction.status.toUpperCase(),
      );
      const wasFailed = ['DENY', 'CANCEL', 'EXPIRE'].includes(
        transaction.status.toUpperCase(),
      );

      const paidAt = isPaid
        ? payload.settlement_time
          ? new Date(payload.settlement_time)
          : new Date()
        : undefined;

      // Update transaction record
      await tx.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: normalizedStatus,
          midtransTransactionId: transaction_id,
          rawResponse: payload as unknown as Prisma.InputJsonValue,
          paidAt: paidAt || transaction.paidAt,
        },
      });

      // Emit outbox events for Kafka publishing
      if (isPaid && !wasPaid) {
        await this.outboxService.emit(
          'PAYMENT',
          transaction.orderId,
          'PAYMENT_COMPLETED',
          {
            eventId,
            eventType: 'PAYMENT_COMPLETED',
            orderId: transaction.orderId,
            transactionId: transaction.id,
            midtransOrderId: transaction.midtransOrderId,
            midtransTransactionId: transaction_id,
            amount: Number(transaction.amount),
            currency: transaction.currency,
            paymentType: payload.payment_type || transaction.channel,
            settledAt: (paidAt || new Date()).toISOString(),
            metadata: transaction.metadata,
          },
          tx,
        );

        this.logger.log(
          `Payment for order ${transaction.orderId} (tx: ${transaction.midtransOrderId}) completed via Midtrans webhook`,
        );
      } else if (isFailed && !wasFailed) {
        await this.outboxService.emit(
          'PAYMENT',
          transaction.orderId,
          'PAYMENT_FAILED',
          {
            eventId,
            eventType: 'PAYMENT_FAILED',
            orderId: transaction.orderId,
            transactionId: transaction.id,
            midtransOrderId: transaction.midtransOrderId,
            midtransTransactionId: transaction_id,
            amount: Number(transaction.amount),
            currency: transaction.currency,
            paymentType: payload.payment_type || transaction.channel,
            status: normalizedStatus,
            metadata: transaction.metadata,
          },
          tx,
        );

        this.logger.warn(
          `Payment for order ${transaction.orderId} (tx: ${transaction.midtransOrderId}) marked as ${normalizedStatus} via Midtrans webhook`,
        );
      }

      return {
        status: 'PROCESSED',
        eventId,
        paymentStatus: normalizedStatus,
      };
    });
  }
}
