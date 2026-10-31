import { Test, type TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MidtransService } from '../midtrans/midtrans.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { TenantBalanceService } from '../tenant-balance/tenant-balance.service.js';

describe('WebhooksService', () => {
  let service: WebhooksService;

  const mockTx = {
    webhookEvent: {
      create: jest.fn(),
    },
    paymentTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPrisma = {
    webhookEvent: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(
      async (callback: (tx: typeof mockTx) => Promise<unknown>) =>
        callback(mockTx),
    ),
  };

  const mockMidtransService = {
    verifySignatureKey: jest.fn(),
  };

  const mockPaymentsRepository = {
    lockStatusForUpdate: jest.fn(),
  };

  const mockTenantBalanceService = {
    credit: jest.fn(),
  };

  const mockOutboxService = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MidtransService, useValue: mockMidtransService },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: PaymentsRepository, useValue: mockPaymentsRepository },
        { provide: TenantBalanceService, useValue: mockTenantBalanceService },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  const validPayload = {
    order_id: 'ORD-20261020-0001-TX1',
    status_code: '200',
    gross_amount: '150000.00',
    signature_key: 'mock-valid-signature',
    transaction_id: 'midtrans-tx-999',
    transaction_status: 'settlement',
    fraud_status: 'accept',
    payment_type: 'bank_transfer',
    settlement_time: '2026-10-20 10:00:00',
  };

  it('throws BadRequestException if signature is invalid', async () => {
    mockMidtransService.verifySignatureKey.mockReturnValue(false);

    await expect(service.handleMidtransWebhook(validPayload)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('skips processing if eventId was already processed (idempotency)', async () => {
    mockMidtransService.verifySignatureKey.mockReturnValue(true);
    mockPrisma.webhookEvent.findUnique.mockResolvedValue({
      id: 'existing-event-id',
    });

    const result = await service.handleMidtransWebhook(validPayload);
    expect(result.status).toBe('ALREADY_PROCESSED');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('handles transaction not found', async () => {
    mockMidtransService.verifySignatureKey.mockReturnValue(true);
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
    mockTx.paymentTransaction.findUnique.mockResolvedValue(null);

    const result = await service.handleMidtransWebhook(validPayload);
    expect(result.status).toBe('TRANSACTION_NOT_FOUND');
    expect(mockTx.paymentTransaction.update).not.toHaveBeenCalled();
    expect(mockOutboxService.emit).not.toHaveBeenCalled();
  });

  it('processes settlement payment, updates transaction and emits PAYMENT_COMPLETED outbox event', async () => {
    mockMidtransService.verifySignatureKey.mockReturnValue(true);
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);

    const mockTransaction = {
      id: 'tx-1',
      orderId: 'ORD-20261020-0001',
      midtransOrderId: 'ORD-20261020-0001-TX1',
      amount: new Prisma.Decimal(150000),
      currency: 'IDR',
      channel: 'SNAP_ALL',
      status: 'PENDING',
      metadata: { planId: 'pro' },
      paidAt: null,
    };

    mockTx.paymentTransaction.findUnique.mockResolvedValue(mockTransaction);

    const result = await service.handleMidtransWebhook(validPayload);

    expect(result.status).toBe('PROCESSED');
    expect(mockTx.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: 'midtrans-tx-999:200:settlement',
        orderId: 'ORD-20261020-0001-TX1',
      }) as unknown,
    });
    expect(mockTx.paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({
        status: 'SETTLEMENT',
        midtransTransactionId: 'midtrans-tx-999',
      }) as unknown,
    });
    expect(mockOutboxService.emit).toHaveBeenCalledWith(
      'PAYMENT',
      'ORD-20261020-0001',
      'PAYMENT_COMPLETED',
      expect.objectContaining({
        orderId: 'ORD-20261020-0001',
        transactionId: 'tx-1',
        amount: 150000,
        currency: 'IDR',
      }),
      mockTx,
    );
  });

  it('processes failed payment and emits PAYMENT_FAILED outbox event', async () => {
    mockMidtransService.verifySignatureKey.mockReturnValue(true);
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);

    const mockTransaction = {
      id: 'tx-2',
      orderId: 'ORD-20261020-0002',
      midtransOrderId: 'ORD-20261020-0002-TX1',
      amount: new Prisma.Decimal(150000),
      currency: 'IDR',
      channel: 'SNAP_ALL',
      status: 'PENDING',
      metadata: null,
      paidAt: null,
    };

    mockTx.paymentTransaction.findUnique.mockResolvedValue(mockTransaction);

    const failedPayload = {
      ...validPayload,
      order_id: 'ORD-20261020-0002-TX1',
      transaction_status: 'deny',
    };

    const result = await service.handleMidtransWebhook(failedPayload);

    expect(result.status).toBe('PROCESSED');
    expect(mockTx.paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-2' },
      data: expect.objectContaining({
        status: 'DENY',
      }) as unknown,
    });
    expect(mockOutboxService.emit).toHaveBeenCalledWith(
      'PAYMENT',
      'ORD-20261020-0002',
      'PAYMENT_FAILED',
      expect.objectContaining({
        orderId: 'ORD-20261020-0002',
        status: 'DENY',
      }),
      mockTx,
    );
  });

  it('does not emit a duplicate completion event for an already settled transaction', async () => {
    mockMidtransService.verifySignatureKey.mockReturnValue(true);
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
    mockTx.paymentTransaction.findUnique.mockResolvedValue({
      id: 'tx-settled',
      orderId: 'ORD-SETTLED',
      midtransOrderId: 'ORD-SETTLED-TX1',
      amount: new Prisma.Decimal(150000),
      currency: 'IDR',
      channel: 'GOPAY',
      status: 'SETTLEMENT',
      metadata: null,
      paidAt: new Date(),
    });
    mockPaymentsRepository.lockStatusForUpdate.mockResolvedValue('SETTLEMENT');
    const result = await service.handleMidtransWebhook({
      ...validPayload,
      order_id: 'ORD-SETTLED-TX1',
    });

    expect(result.status).toBe('PROCESSED');
    expect(mockTx.paymentTransaction.update).toHaveBeenCalled();
    expect(mockOutboxService.emit).not.toHaveBeenCalled();
  });
});
