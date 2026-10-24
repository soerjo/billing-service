import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { PaymentsRepository } from './payments.repository.js';
import { MidtransService } from '../midtrans/midtrans.service.js';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { RedisIdempotencyService } from '../../common/redis/redis-idempotency.service.js';
import { PaymentChannel, Prisma } from '@prisma/client';

describe('PaymentsService', () => {
  let service: PaymentsService;
  const mockRepository = {
    createTransaction: jest.fn(),
    findByOrderId: jest.fn(),
    findLatestByOrderId: jest.fn(),
    findSuccessfulByOrderId: jest.fn(),
    findCurrentByOrderId: jest.fn(),
    findPendingByOrderId: jest.fn(),
    findPendingTransactions: jest.fn(),
    findUnsettledTransactions: jest.fn(),
    findTransactionsForSync: jest.fn(),
    findTransactionsForBatchSync: jest.fn(),
    listOrders: jest.fn(),
    updateTransactionStatus: jest.fn(),
    withOrderLock: jest.fn(),
  };

  const mockMidtransService = {
    createSnapTransaction: jest.fn(),
    createQrTransaction: jest.fn(),
    createVirtualAccount: jest.fn(),
    getTransactionStatus: jest.fn(),
  };

  const mockPaymentMethodsService = {
    findEnabledBank: jest.fn(),
    listEnabledVirtualAccountBanks: jest.fn(),
  };

  const mockOutboxService = {
    emit: jest.fn(),
  };

  const mockRedisIdempotency = {
    execute: jest.fn(
      async <T>(
        _scope: string,
        _key: string,
        _req: unknown,
        operation: () => Promise<T>,
      ) => operation(),
    ),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockRepository.withOrderLock.mockImplementation(
      async (_orderId: string, callback: (tx: unknown) => Promise<unknown>) =>
        callback({}),
    );
    mockRedisIdempotency.execute.mockImplementation(
      async <T>(
        _scope: string,
        _key: string,
        _req: unknown,
        operation: () => Promise<T>,
      ) => operation(),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsRepository, useValue: mockRepository },
        { provide: MidtransService, useValue: mockMidtransService },
        { provide: PaymentMethodsService, useValue: mockPaymentMethodsService },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: RedisIdempotencyService, useValue: mockRedisIdempotency },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('createSnapPayment', () => {
    it('creates Snap transaction and persists payment record', async () => {
      mockMidtransService.createSnapTransaction.mockResolvedValue({
        token: 'snap-token-123',
        redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/token',
        requestPayload: { order_id: 'ORD-1-TX1' },
        rawResponse: { token: 'snap-token-123' },
      });

      mockRepository.createTransaction.mockResolvedValue({
        id: 'tx-1',
        orderId: 'ORD-1',
        amount: new Prisma.Decimal(150000),
        status: 'PENDING',
      });

      const result = await service.createSnapPayment({
        orderId: 'ORD-1',
        amount: 150000,
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        description: 'Test checkout',
      });

      expect(result.orderId).toBe('ORD-1');
      expect(result.transactionId).toBe('tx-1');
      expect(result.snapToken).toBe('snap-token-123');
      expect(result.status).toBe('PENDING');
      expect(mockMidtransService.createSnapTransaction).toHaveBeenCalled();
      expect(mockRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'ORD-1',
          channel: PaymentChannel.SNAP_ALL,
        }),
        expect.anything(),
      );
    });

    it('rejects a new attempt when the order already has a successful payment', async () => {
      mockRepository.findSuccessfulByOrderId.mockResolvedValue({
        id: 'tx-paid',
        orderId: 'ORD-PAID',
        status: 'SETTLEMENT',
      });

      await expect(
        service.createSnapPayment({ orderId: 'ORD-PAID', amount: 150000 }),
      ).rejects.toThrow(ConflictException);
      expect(mockMidtransService.createSnapTransaction).not.toHaveBeenCalled();
    });
    it('rejects a second attempt while an existing attempt is pending', async () => {
      mockRepository.findPendingByOrderId.mockResolvedValue({
        id: 'tx-active',
        orderId: 'ORD-ACTIVE',
        status: 'PENDING',
      });

      await expect(
        service.createQrPayment({ orderId: 'ORD-ACTIVE', amount: 150000 }),
      ).rejects.toThrow(ConflictException);
      expect(mockMidtransService.createQrTransaction).not.toHaveBeenCalled();
    });
  });

  describe('createQrPayment', () => {
    it('creates QRIS transaction and returns standard QR payload', async () => {
      mockMidtransService.createQrTransaction.mockResolvedValue({
        orderId: 'ORD-QR-123',
        transactionStatus: 'pending',
        qrString: '0002010102129999',
        qrImageUrl:
          'https://api.sandbox.midtrans.com/v2/qris/ORD-QR-123/qr-code',
        expiryTime: '2026-10-25 10:00:00',
        requestPayload: {},
        rawResponse: {},
      });

      mockRepository.createTransaction.mockResolvedValue({
        id: 'tx-qr',
        orderId: 'ORD-QR',
        amount: new Prisma.Decimal(50000),
        status: 'PENDING',
      });

      const result = await service.createQrPayment({
        orderId: 'ORD-QR',
        amount: 50000,
        customerName: 'Bob',
      });

      expect(result.orderId).toBe('ORD-QR');
      expect(result.qrString).toBe('0002010102129999');
      expect(result.qrImageUrl).toBe(
        'https://api.sandbox.midtrans.com/v2/qris/ORD-QR-123/qr-code',
      );
      expect(result.expiresAt).toBe('2026-10-25 10:00:00');
      expect(result.status).toBe('PENDING');
      expect(mockRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'ORD-QR',
          channel: PaymentChannel.QRIS,
        }),
        expect.anything(),
      );
    });
  });

  describe('createVirtualAccountPayment', () => {
    it('creates bank virtual account when bank is enabled', async () => {
      mockPaymentMethodsService.findEnabledBank.mockResolvedValue({
        code: 'bca',
        name: 'BCA Virtual Account',
        enabled: true,
      });

      mockMidtransService.createVirtualAccount.mockResolvedValue({
        bank: 'bca',
        vaNumber: '1234567890123456',
        transactionStatus: 'pending',
        expiryTime: '2026-10-25 12:00:00',
        requestPayload: {},
        rawResponse: {},
      });

      mockRepository.createTransaction.mockResolvedValue({
        id: 'tx-va',
        orderId: 'ORD-VA',
        amount: new Prisma.Decimal(100000),
        status: 'PENDING',
      });

      const result = await service.createVirtualAccountPayment({
        orderId: 'ORD-VA',
        amount: 100000,
        bank: 'bca',
      });

      expect(result.orderId).toBe('ORD-VA');
      expect(result.bank).toBe('bca');
      expect(result.vaNumber).toBe('1234567890123456');
      expect(mockRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'ORD-VA',
          channel: PaymentChannel.BANK_TRANSFER,
          vaBank: 'bca',
        }),
        expect.anything(),
      );
    });

    it('rejects virtual account creation if bank is not enabled', async () => {
      mockPaymentMethodsService.findEnabledBank.mockResolvedValue(null);

      await expect(
        service.createVirtualAccountPayment({
          orderId: 'ORD-VA-FAIL',
          amount: 100000,
          bank: 'bca',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid Midtrans expiry timestamp', async () => {
      mockPaymentMethodsService.findEnabledBank.mockResolvedValue({
        code: 'bca',
        enabled: true,
      });
      mockMidtransService.createVirtualAccount.mockResolvedValue({
        bank: 'bca',
        vaNumber: '1234567890123456',
        transactionStatus: 'pending',
        expiryTime: 'not-a-date',
        requestPayload: {},
        rawResponse: {},
      });

      await expect(
        service.createVirtualAccountPayment({
          orderId: 'ORD-VA-INVALID-DATE',
          amount: 100000,
          bank: 'bca',
        }),
      ).rejects.toThrow(BadGatewayException);
      expect(mockRepository.createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('getPaymentStatus and transactions', () => {
    it('returns latest payment status for an order', async () => {
      mockRepository.findCurrentByOrderId.mockResolvedValue({
        id: 'tx-1',
        orderId: 'ORD-1',
        midtransOrderId: 'ORD-1-TX1',
        amount: new Prisma.Decimal(150000),
        currency: 'IDR',
        channel: 'SNAP_ALL',
        status: 'SETTLEMENT',
        paidAt: new Date('2026-10-24T12:00:00Z'),
        createdAt: new Date('2026-10-24T11:00:00Z'),
      });

      const status = await service.getPaymentStatus('ORD-1');
      expect(status.orderId).toBe('ORD-1');
      expect(status.status).toBe('SETTLEMENT');
      expect(status.amount).toBe(150000);
    });

    it('returns payment transaction attempts for an order', async () => {
      mockRepository.findByOrderId.mockResolvedValue([
        { id: 'tx-2', orderId: 'ORD-1', status: 'SETTLEMENT' },
        { id: 'tx-1', orderId: 'ORD-1', status: 'EXPIRE' },
      ]);

      const transactions = await service.getPaymentTransactions('ORD-1');
      expect(transactions).toHaveLength(2);
    });
  });

  describe('listPaymentOrders', () => {
    it('returns latest transaction rows with pagination metadata', async () => {
      mockRepository.listOrders.mockResolvedValue([
        {
          orderId: 'ORD-1',
          id: 'tx-1',
          midtransOrderId: 'ORD-1-TX1',
          amount: new Prisma.Decimal(105000),
          currency: 'IDR',
          channel: PaymentChannel.SNAP_ALL,
          status: 'PENDING',
          paidAt: null,
          createdAt: new Date('2026-10-24T10:00:00Z'),
          updatedAt: new Date('2026-10-24T10:00:00Z'),
          totalCount: 2n,
        },
      ]);

      const result = await service.listPaymentOrders({
        status: 'PENDING',
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-11-01T00:00:00.000Z',
        page: 1,
        pageSize: 1,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].amount).toBe(105000);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(1);
      expect(result.total).toBe(2);
      expect(mockRepository.listOrders).toHaveBeenCalledWith({
        status: 'PENDING',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-11-01T00:00:00.000Z'),
        page: 1,
        pageSize: 1,
      });
    });

    it('rejects a non-ascending date range', async () => {
      await expect(
        service.listPaymentOrders({
          startDate: '2026-11-01T00:00:00.000Z',
          endDate: '2026-10-01T00:00:00.000Z',
          page: 1,
          pageSize: 50,
        }),
      ).rejects.toThrow('endDate must be later than startDate');
    });
  });

  describe('syncPaymentStatus and syncBatch', () => {
    const mockTx = {
      id: 'tx-sync-1',
      orderId: 'ORD-SYNC-1',
      midtransOrderId: 'ORD-SYNC-1-TX1',
      amount: new Prisma.Decimal(105000),
      currency: 'IDR',
      channel: 'SNAP_ALL',
      status: 'PENDING',
      metadata: { plan: 'pro' },
      paidAt: null,
    };

    it('updates status to SETTLEMENT and emits PAYMENT_COMPLETED event when status changed', async () => {
      mockRepository.findTransactionsForSync.mockResolvedValue([mockTx]);
      mockMidtransService.getTransactionStatus.mockResolvedValue({
        statusCode: '200',
        transactionStatus: 'settlement',
        fraudStatus: 'accept',
        transactionId: 'mt-tx-123',
        paymentType: 'gopay',
        settlementTime: '2026-10-24T12:00:00.000Z',
        rawResponse: { status_code: '200' },
      });

      const res = await service.syncPaymentStatus('ORD-SYNC-1');

      expect(res.status).toBe('SETTLEMENT');
      expect(res.statusChanged).toBe(true);
      expect(mockRepository.updateTransactionStatus).toHaveBeenCalledWith(
        'tx-sync-1',
        'SETTLEMENT',
        expect.objectContaining({
          midtransTransactionId: 'mt-tx-123',
        }),
      );
      expect(mockOutboxService.emit).toHaveBeenCalledWith(
        'PAYMENT',
        'ORD-SYNC-1',
        'PAYMENT_COMPLETED',
        expect.objectContaining({
          orderId: 'ORD-SYNC-1',
          source: 'STATUS_SYNC',
        }),
      );
    });

    it('updates status to DENY and emits PAYMENT_FAILED when payment was denied', async () => {
      mockRepository.findTransactionsForSync.mockResolvedValue([mockTx]);
      mockMidtransService.getTransactionStatus.mockResolvedValue({
        statusCode: '200',
        transactionStatus: 'deny',
        transactionId: 'mt-tx-deny',
        paymentType: 'credit_card',
        rawResponse: {},
      });

      const res = await service.syncPaymentStatus('ORD-SYNC-1');

      expect(res.status).toBe('DENY');
      expect(res.statusChanged).toBe(true);
      expect(mockOutboxService.emit).toHaveBeenCalledWith(
        'PAYMENT',
        'ORD-SYNC-1',
        'PAYMENT_FAILED',
        expect.objectContaining({
          status: 'DENY',
          source: 'STATUS_SYNC',
        }),
      );
    });

    it('returns without updating when status is unchanged', async () => {
      mockRepository.findTransactionsForSync.mockResolvedValue([
        { ...mockTx, status: 'SETTLEMENT' },
      ]);
      mockMidtransService.getTransactionStatus.mockResolvedValue({
        statusCode: '200',
        transactionStatus: 'settlement',
        paymentType: 'gopay',
        rawResponse: {},
      });

      const res = await service.syncPaymentStatus('ORD-SYNC-1');

      expect(res.status).toBe('SETTLEMENT');
      expect(res.statusChanged).toBe(false);
      expect(mockRepository.updateTransactionStatus).not.toHaveBeenCalled();
      expect(mockOutboxService.emit).not.toHaveBeenCalled();
    });

    it('handles transaction not found in Midtrans', async () => {
      mockRepository.findTransactionsForSync.mockResolvedValue([mockTx]);
      mockMidtransService.getTransactionStatus.mockResolvedValue(null);

      const res = await service.syncPaymentStatus('ORD-SYNC-1');

      expect(res.synced).toBe(false);
      expect(res.message).toBe('Transaction not found in Midtrans');
    });

    it('syncBatch handles explicit orderIds in parallel bulk without serial for loops', async () => {
      mockRepository.findTransactionsForBatchSync.mockResolvedValue([mockTx]);
      mockMidtransService.getTransactionStatus.mockResolvedValue({
        statusCode: '200',
        transactionStatus: 'settlement',
        rawResponse: {},
      });

      const batchRes = await service.syncBatch({
        orderIds: ['ORD-SYNC-1', 'ORD-NON-EXISTENT'],
      });

      expect(mockRepository.findTransactionsForBatchSync).toHaveBeenCalledWith([
        'ORD-SYNC-1',
        'ORD-NON-EXISTENT',
      ]);
      expect(batchRes.total).toBe(1);
      expect(batchRes.results[0].orderId).toBe('ORD-SYNC-1');
    });

    it('syncBatch syncs all unsettled transactions when no payload or orderIds provided', async () => {
      mockRepository.findTransactionsForBatchSync.mockResolvedValue([mockTx]);
      mockMidtransService.getTransactionStatus.mockResolvedValue({
        statusCode: '200',
        transactionStatus: 'settlement',
        rawResponse: {},
      });

      const batchRes = await service.syncBatch();

      expect(mockRepository.findTransactionsForBatchSync).toHaveBeenCalledWith(
        undefined,
      );
      expect(batchRes.total).toBe(1);
    });
  });
});
