/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { Kafka } from 'kafkajs';
import axios from 'axios';
import { validate } from 'class-validator';
import { PaymentChannel, PaymentProvider } from '@prisma/client';
import { ListPaymentOrdersDto } from './modules/payments/dto/list-payment-orders.dto.js';
import { PaymentsRepository } from './modules/payments/payments.repository.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { PaymentsController } from './modules/payments/payments.controller.js';
import { PaymentMethodsService } from './modules/payment-methods/payment-methods.service.js';
import { PaymentMethodsController } from './modules/payment-methods/payment-methods.controller.js';
import { WebhooksService } from './modules/webhooks/webhooks.service.js';
import { WebhooksController } from './modules/webhooks/webhooks.controller.js';
import { SignaturesController } from './modules/signatures/signatures.controller.js';
import { SignaturesService } from './modules/signatures/signatures.service.js';
import { MidtransService } from './modules/midtrans/midtrans.service.js';
import { OutboxService } from './modules/outbox/outbox.service.js';
import { TenantBalanceService } from './modules/tenant-balance/tenant-balance.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisIdempotencyService } from './common/redis/redis-idempotency.service.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';
import { createRequestLoggingMiddleware } from './common/middleware/request-logging.middleware.js';
import { validate as validateEnvironment } from './config/env.validation.js';
import {
  BadGatewayException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateHmacSignature } from './common/utils/signature.util.js';

describe('coverage gaps', () => {
  it('covers request logging finish and metrics skip', () => {
    const logger = { info: jest.fn() } as any;
    const metrics = { recordRequest: jest.fn() } as any;
    const middleware = createRequestLoggingMiddleware(logger, metrics);
    const next = jest.fn();
    const skipped = { path: '/metrics' } as any;
    middleware(skipped, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);

    const listeners: Record<string, () => void> = {};
    const response = {
      statusCode: 200,
      on: jest.fn((event: string, callback: () => void) => {
        listeners[event] = callback;
      }),
    } as any;
    const request = {
      path: '/api/v1/payments/snap',
      method: 'POST',
      originalUrl: '/api/v1/payments/snap',
      route: { path: '/api/v1/payments/snap' },
    } as any;
    middleware(request, response, next);
    listeners.finish();
    expect(logger.info).toHaveBeenCalled();
    expect(metrics.recordRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/payments/snap',
      200,
      expect.any(Number),
    );
  });

  it('validates required payment order date range', async () => {
    const query = new ListPaymentOrdersDto();
    query.startDate = '2026-10-01T00:00:00.000Z';
    query.endDate = '2026-11-01T00:00:00.000Z';
    query.page = 1;
    query.pageSize = 50;
    expect(await validate(query)).toHaveLength(0);

    const invalid = new ListPaymentOrdersDto();
    invalid.status = 'UNKNOWN' as never;
    invalid.page = 0;
    invalid.pageSize = 101;
    expect(await validate(invalid)).not.toHaveLength(0);
  });
  it('parses string boolean environment flags correctly', () => {
    const config = validateEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/test',
      MIDTRANS_IS_PRODUCTION: 'false',
      KAFKA_ENABLED: 'false',
    });

    expect(config.MIDTRANS_IS_PRODUCTION).toBe(false);
    expect(config.KAFKA_ENABLED).toBe(false);
  });
  it('rejects invalid environment configuration', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'development' })).toThrow();
  });
  it('covers ApiKeyGuard all branches', () => {
    const reflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    const configService = {
      get: jest.fn(),
    } as any;

    const guard = new ApiKeyGuard(reflector, configService);

    const makeContext = (
      headers: Record<string, string | undefined>,
      method = 'GET',
      url = '/api/v1/payments',
      body?: unknown,
    ) =>
      ({
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({
          getRequest: () => ({ headers, method, url, body }),
        }),
      }) as any;

    // 1. Public route
    reflector.getAllAndOverride.mockReturnValueOnce(true);
    expect(guard.canActivate(makeContext({}))).toBe(true);

    // 2. Not public, API_KEY not set in dev/test
    reflector.getAllAndOverride.mockReturnValue(false);
    configService.get.mockReturnValue(undefined);
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(guard.canActivate(makeContext({}))).toBe(true);

    // 3. Not public, API_KEY not set in production -> UnauthorizedException
    process.env.NODE_ENV = 'production';
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
    process.env.NODE_ENV = origEnv;

    // 4. API_KEY configured: invalid / missing key
    configService.get.mockReturnValue('secret-key-123');
    expect(() =>
      guard.canActivate(makeContext({ 'x-api-key': 'wrong' })),
    ).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );

    // 5. API_KEY valid, skip signature decorator
    reflector.getAllAndOverride
      .mockReturnValueOnce(false) // isPublic
      .mockReturnValueOnce(true); // skipSignature
    expect(
      guard.canActivate(makeContext({ 'x-api-key': 'secret-key-123' })),
    ).toBe(true);

    // 6. Signature checks: missing X-Signature
    reflector.getAllAndOverride.mockReturnValue(false);
    expect(() =>
      guard.canActivate(makeContext({ 'x-api-key': 'secret-key-123' })),
    ).toThrow('Missing X-Signature header');

    // 7. Signature checks: missing X-Timestamp
    expect(() =>
      guard.canActivate(
        makeContext({
          'x-api-key': 'secret-key-123',
          'x-signature': 'sig',
        }),
      ),
    ).toThrow('Missing X-Timestamp header');

    // 8. Signature checks: invalid timestamp format
    expect(() =>
      guard.canActivate(
        makeContext({
          'x-api-key': 'secret-key-123',
          'x-signature': 'sig',
          'x-timestamp': 'not-a-date',
        }),
      ),
    ).toThrow('Invalid X-Timestamp header format');

    // 9. Signature checks: expired timestamp (> 5 mins)
    const oldTs = (Date.now() - 10 * 60 * 1000).toString();
    expect(() =>
      guard.canActivate(
        makeContext({
          'x-api-key': 'secret-key-123',
          'x-signature': 'sig',
          'x-timestamp': oldTs,
        }),
      ),
    ).toThrow('Request signature expired');

    // 10. Signature checks: invalid signature
    const nowTs = Date.now().toString();
    expect(() =>
      guard.canActivate(
        makeContext({
          'x-api-key': 'secret-key-123',
          'x-signature': 'invalid-signature-hex',
          'x-timestamp': nowTs,
        }),
      ),
    ).toThrow('Invalid request signature');

    // 11. Valid signature via x-api-key
    const validSig = generateHmacSignature(
      `GET:/api/v1/payments:${nowTs}:`,
      'secret-key-123',
    );
    expect(
      guard.canActivate(
        makeContext({
          'x-api-key': 'secret-key-123',
          'x-signature': validSig,
          'x-timestamp': nowTs,
        }),
      ),
    ).toBe(true);

    // 12. Valid signature via Bearer auth
    expect(
      guard.canActivate(
        makeContext({
          authorization: 'Bearer secret-key-123',
          'x-signature': validSig,
          'x-timestamp': nowTs,
        }),
      ),
    ).toBe(true);
  });

  it('covers payments repository operations', async () => {
    const prisma = {
      paymentTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'tx-1' }]),
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 'tx-1' }),
        update: jest.fn().mockResolvedValue({ id: 'tx-1' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          orderId: 'ORD-1',
          id: 'tx-1',
          midtransOrderId: 'ORD-1-TX1',
          amount: 100,
          currency: 'IDR',
          channel: PaymentChannel.SNAP_ALL,
          status: 'PENDING',
          paidAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        Promise.resolve(
          callback({
            $executeRaw: jest.fn().mockResolvedValue(1),
          }),
        ),
      ),
    } as any;

    const repository = new PaymentsRepository(prisma);

    // create with defaults
    await repository.createTransaction({
      orderId: 'ORD-1',
      amount: 100,
      midtransOrderId: 'ORD-1-TX1',
    });
    expect(prisma.paymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'ORD-1',
        currency: 'IDR',
        provider: PaymentProvider.MIDTRANS,
        channel: PaymentChannel.SNAP_ALL,
        status: 'PENDING',
      }),
    });

    // findByOrderId
    await repository.findByOrderId('ORD-1');
    expect(prisma.paymentTransaction.findMany).toHaveBeenCalledWith({
      where: { orderId: 'ORD-1' },
      orderBy: { createdAt: 'desc' },
    });

    // findLatestByOrderId found
    prisma.paymentTransaction.findFirst.mockResolvedValueOnce({ id: 'tx-1' });
    const found = await repository.findLatestByOrderId('ORD-1');
    expect(found.id).toBe('tx-1');

    // findLatestByOrderId not found
    prisma.paymentTransaction.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.findLatestByOrderId('ORD-MISSING'),
    ).rejects.toThrow();

    // findByMidtransOrderId
    await repository.findByMidtransOrderId('ORD-1-TX1');
    expect(prisma.paymentTransaction.findUnique).toHaveBeenCalledWith({
      where: { midtransOrderId: 'ORD-1-TX1' },
    });
    prisma.paymentTransaction.findFirst.mockResolvedValueOnce({
      id: 'tx-paid',
      orderId: 'ORD-1',
      status: 'SETTLEMENT',
    });
    const successful = await repository.findSuccessfulByOrderId('ORD-1');
    expect(successful?.status).toBe('SETTLEMENT');

    prisma.paymentTransaction.findFirst.mockResolvedValueOnce({
      id: 'tx-paid',
      orderId: 'ORD-1',
      status: 'SETTLEMENT',
    });
    const current = await repository.findCurrentByOrderId('ORD-1');
    expect(current.status).toBe('SETTLEMENT');
    // findUnsettledTransactions and findPendingTransactions
    prisma.paymentTransaction.findMany.mockResolvedValueOnce([
      { id: 'tx-unsettled' },
    ]);
    const unsettledAll = await repository.findUnsettledTransactions();
    expect(unsettledAll).toHaveLength(1);

    prisma.paymentTransaction.findMany.mockResolvedValueOnce([
      { id: 'tx-pending' },
    ]);
    const pending = await repository.findPendingTransactions(10);
    expect(pending).toHaveLength(1);
    // findTransactionsForSync by orderId (unsettled)
    prisma.paymentTransaction.findMany.mockResolvedValueOnce([
      { id: 'tx-u', orderId: 'ORD-1', status: 'PENDING' },
    ]);
    const syncByOrderUnsettled =
      await repository.findTransactionsForSync('ORD-1');
    expect(syncByOrderUnsettled).toHaveLength(1);

    // findTransactionsForSync by orderId (only settled)
    prisma.paymentTransaction.findMany.mockResolvedValueOnce([
      { id: 'tx-s', orderId: 'ORD-1', status: 'SETTLEMENT' },
    ]);
    const syncByOrderSettled =
      await repository.findTransactionsForSync('ORD-1');
    expect(syncByOrderSettled).toHaveLength(1);

    // findTransactionsForSync not found
    prisma.paymentTransaction.findMany.mockResolvedValueOnce([]);
    await expect(repository.findTransactionsForSync('NONE')).rejects.toThrow(
      NotFoundException,
    );
    // findTransactionsForBatchSync empty ids
    prisma.paymentTransaction.findMany.mockResolvedValueOnce([
      { id: 'tx-all', status: 'PENDING' },
    ]);
    const batchEmpty = await repository.findTransactionsForBatchSync();
    expect(batchEmpty).toHaveLength(1);

    // findTransactionsForBatchSync with ids
    prisma.paymentTransaction.findMany.mockResolvedValueOnce([
      { id: 'tx-1', orderId: 'ORD-1', status: 'PENDING' },
      { id: 'tx-2', orderId: 'ORD-2', status: 'SETTLEMENT' },
    ]);
    const batchWithIds = await repository.findTransactionsForBatchSync([
      'ORD-1',
      'ORD-2',
    ]);
    expect(batchWithIds).toHaveLength(2);

    prisma.paymentTransaction.findFirst.mockResolvedValueOnce({
      id: 'tx-active',
      orderId: 'ORD-1',
      status: 'PENDING',
    });
    const active = await repository.findPendingByOrderId('ORD-1');
    expect(active?.status).toBe('PENDING');

    const locked = await repository.withOrderLock('ORD-1', () =>
      Promise.resolve('locked'),
    );
    expect(locked).toBe('locked');
    const orders = await repository.listOrders({
      status: 'PENDING',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-11-01T00:00:00.000Z'),
      page: 1,
      pageSize: 10,
    });
    expect(orders).toHaveLength(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();

    // updateTransactionStatus without tx
    await repository.updateTransactionStatus('tx-1', 'SETTLEMENT', {
      midtransTransactionId: 'mt-1',
      signatureKey: 'sig',
      paidAt: new Date(0),
    });
    expect(prisma.paymentTransaction.update).toHaveBeenCalled();

    // updateTransactionStatus with tx
    const mockTx = {
      paymentTransaction: {
        update: jest.fn().mockResolvedValue({ id: 'tx-1' }),
      },
    } as any;
    await repository.updateTransactionStatus(
      'tx-1',
      'CANCEL',
      undefined,
      mockTx,
    );
    expect(mockTx.paymentTransaction.update).toHaveBeenCalled();
  });
  it('covers PaymentsController and WebhooksController routes', async () => {
    const mockPaymentsService = {
      createSnapPayment: jest.fn().mockResolvedValue({ orderId: 'ORD-1' }),
      createQrPayment: jest.fn().mockResolvedValue({ orderId: 'ORD-1' }),
      createVirtualAccountPayment: jest
        .fn()
        .mockResolvedValue({ orderId: 'ORD-1' }),
      listPaymentOrders: jest.fn().mockResolvedValue({ orders: [] }),
      getPaymentStatus: jest.fn().mockResolvedValue({ orderId: 'ORD-1' }),
      getPaymentTransactions: jest.fn().mockResolvedValue([]),
      syncBatch: jest.fn().mockResolvedValue({ total: 1 }),
      syncPaymentStatus: jest.fn().mockResolvedValue({ status: 'SETTLEMENT' }),
    } as any;

    const controller = new PaymentsController(mockPaymentsService);
    await controller.createSnapPayment({ orderId: 'ORD-1', amount: 100 });
    await controller.createQrPayment({ orderId: 'ORD-1', amount: 100 });
    await controller.createVirtualAccountPayment({
      orderId: 'ORD-1',
      amount: 100,
      bank: 'bca',
    });
    await controller.listPaymentOrders({
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-11-01T00:00:00.000Z',
      page: 1,
      pageSize: 50,
    });
    await controller.getPaymentStatus('ORD-1');
    await controller.getPaymentTransactions('ORD-1');
    await controller.syncBatch({ orderIds: ['ORD-1'] });
    await controller.syncPaymentStatus('ORD-1');

    expect(mockPaymentsService.createSnapPayment).toHaveBeenCalled();
    expect(mockPaymentsService.createQrPayment).toHaveBeenCalled();
    expect(mockPaymentsService.createVirtualAccountPayment).toHaveBeenCalled();
    expect(mockPaymentsService.listPaymentOrders).toHaveBeenCalled();
    expect(mockPaymentsService.getPaymentStatus).toHaveBeenCalled();
    expect(mockPaymentsService.getPaymentTransactions).toHaveBeenCalled();
    expect(mockPaymentsService.syncBatch).toHaveBeenCalled();
    expect(mockPaymentsService.syncPaymentStatus).toHaveBeenCalled();

    const mockWebhooksService = {
      handleMidtransWebhook: jest.fn().mockResolvedValue({ status: 'OK' }),
    } as any;
    const webhooksController = new WebhooksController(mockWebhooksService);
    await webhooksController.handleMidtransWebhook({} as any);
    expect(mockWebhooksService.handleMidtransWebhook).toHaveBeenCalled();
  });

  it('covers PaymentMethodsService and PaymentMethodsController', async () => {
    const prisma = {
      virtualAccountBank: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ code: 'bca', name: 'BCA Virtual Account' }]),
        findFirst: jest.fn().mockResolvedValue({
          code: 'bca',
          name: 'BCA Virtual Account',
          enabled: true,
        }),
      },
    } as any;

    const service = new PaymentMethodsService(prisma);
    const banks = await service.listEnabledVirtualAccountBanks();
    expect(banks).toHaveLength(1);
    const bank = await service.findEnabledBank('bca');
    expect(bank?.code).toBe('bca');

    const controller = new PaymentMethodsController(service);
    const list = await controller.listVirtualAccountBanks();
    expect(list).toHaveLength(1);
  });

  it('covers SignaturesService and SignaturesController', () => {
    const signaturesService = new SignaturesService({
      get: jest.fn().mockReturnValue('test-api-key'),
    } as any);
    const signaturesController = new SignaturesController(signaturesService);
    const generated = signaturesController.generateSignature({
      method: 'GET',
      path: '/api/v1/payments',
    });
    expect(generated.signature).toBeDefined();
  });

  it('covers Midtrans mock, HTTP success/error, and signatures', async () => {
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'MIDTRANS_SERVER_KEY') return 'test-key';
        if (key === 'MIDTRANS_IS_PRODUCTION') return false;
        return undefined;
      }),
    } as any;

    const midtrans = new MidtransService(mockConfig);
    const post = jest.spyOn(axios, 'post');

    post.mockResolvedValueOnce({
      data: {
        token: 'snap-token',
        redirect_url: 'https://redirect',
      },
    });

    const snap = await midtrans.createSnapTransaction({
      orderId: 'ORD-SNAP',
      grossAmount: 100000,
      customerDetails: { first_name: 'Alice' },
    });
    expect(snap.token).toBe('snap-token');

    post.mockResolvedValueOnce({
      data: {
        order_id: 'ORD-VA',
        transaction_status: 'pending',
        va_numbers: [{ bank: 'bca', va_number: '1234567890' }],
        expiry_time: '2026-10-25 10:00:00',
      },
    });

    const va = await midtrans.createVirtualAccount({
      orderId: 'ORD-VA',
      grossAmount: 100000,
      bank: 'bca',
    });
    expect(va.vaNumber).toBe('1234567890');

    post.mockResolvedValueOnce({
      data: {
        order_id: 'ORD-QR-OK',
        transaction_status: 'pending',
        qr_string: '0002010102120000',
        actions: [
          { name: 'generate-qr-code', url: 'https://api.midtrans.com/qr' },
        ],
        expiry_time: '2026-10-25 10:00:00',
      },
    });
    const qrOk = await midtrans.createQrTransaction({
      orderId: 'ORD-QR-OK',
      grossAmount: 100000,
      customerDetails: { first_name: 'Alice', email: 'alice@example.com' },
      itemDetails: [
        { id: 'item-1', name: 'Item 1', price: 100000, quantity: 1 },
      ],
    });
    expect(qrOk.qrImageUrl).toBe('https://api.midtrans.com/qr');
    expect(qrOk.qrString).toBe('0002010102120000');

    // Error branch
    post.mockRejectedValueOnce(new Error('network error'));
    await expect(
      midtrans.createSnapTransaction({
        orderId: 'ORD-FAIL',
        grossAmount: 100,
      }),
    ).rejects.toThrow('Midtrans Snap error');

    // VA Error branch
    post.mockRejectedValueOnce(new Error('va error'));
    await expect(
      midtrans.createVirtualAccount({
        orderId: 'ORD-VA-FAIL',
        grossAmount: 100,
        bank: 'bca',
      }),
    ).rejects.toThrow('Midtrans virtual account error');

    // QR Error branch
    post.mockRejectedValueOnce(new Error('qr error'));
    await expect(
      midtrans.createQrTransaction({
        orderId: 'ORD-QR-FAIL',
        grossAmount: 100,
      }),
    ).rejects.toThrow('Midtrans QRIS error');

    post.mockRestore();
    // getTransactionStatus branches
    const get = jest.spyOn(axios, 'get');
    get.mockResolvedValueOnce({
      data: {
        status_code: '200',
        transaction_status: 'settlement',
        order_id: 'ORD-STATUS',
        gross_amount: '100000.00',
      },
    });
    const statusResult = await midtrans.getTransactionStatus('ORD-STATUS');
    expect(statusResult?.transactionStatus).toBe('settlement');

    // 404 branch
    get.mockRejectedValueOnce({ response: { status: 404 } });
    const notFoundResult = await midtrans.getTransactionStatus('ORD-NOTFOUND');
    expect(notFoundResult).toBeNull();

    // 500 error branch
    get.mockRejectedValueOnce(new Error('midtrans server down'));
    await expect(midtrans.getTransactionStatus('ORD-ERR')).rejects.toThrow(
      'Midtrans status error',
    );
    get.mockRestore();

    // Signature verification
    expect(
      midtrans.verifySignatureKey({
        orderId: 'ORD-1',
        statusCode: '200',
        grossAmount: '100000',
        signatureKey: 'bad-signature',
      }),
    ).toBe(false);

    // Empty server key in dev bypasses signature
    const emptyConfig = {
      get: jest.fn(() => ''),
    } as any;
    const devMidtrans = new MidtransService(emptyConfig);
    const mockStatus = await devMidtrans.getTransactionStatus('ORD-DEV');
    expect(mockStatus?.transactionStatus).toBe('settlement');
    expect(
      devMidtrans.verifySignatureKey({
        orderId: 'ORD-1',
        statusCode: '200',
        grossAmount: '100000',
        signatureKey: 'any',
      }),
    ).toBe(true);
  });

  it('covers outbox lifecycle, relay branches, and Prisma lifecycle', async () => {
    const prisma = {
      outboxEvent: {
        create: jest.fn().mockResolvedValue({ id: 'e' }),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'e' }),
      },
    } as any;
    const config = { get: jest.fn().mockReturnValue('kafka:29092') } as any;

    const outbox = new OutboxService(prisma, config);
    await outbox.emit('PAYMENT', 'ord-1', 'PAYMENT_COMPLETED', { x: 1 });
    await outbox.emit('PAYMENT', 'ord-1', 'PAYMENT_FAILED', { x: 2 });
    await outbox.emit('UNKNOWN', 'ord-1', 'UNKNOWN_EVENT', { x: 3 });

    // processPendingEvents without pending
    prisma.outboxEvent.findMany.mockResolvedValueOnce([]);
    expect(await outbox.processPendingEvents()).toBe(0);

    // processPendingEvents fallback without kafka producer
    prisma.outboxEvent.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        eventType: 'PAYMENT_COMPLETED',
        aggregateId: 'ord-1',
        payload: { a: 1 },
      },
      {
        id: 'e-unknown',
        eventType: 'UNKNOWN',
        aggregateId: 'ord-1',
        payload: { a: 2 },
      },
    ]);
    expect(await outbox.processPendingEvents()).toBe(2);

    // processPendingEvents with kafka producer
    const producer = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
    };
    (outbox as any).producer = producer;

    prisma.outboxEvent.findMany.mockResolvedValueOnce([
      {
        id: 'e-success',
        eventType: 'PAYMENT_COMPLETED',
        aggregateId: 'ord-1',
        payload: { a: 1 },
      },
      {
        id: 'e-failed-type',
        eventType: 'PAYMENT_FAILED',
        aggregateId: 'ord-1',
        payload: { a: 2 },
      },
    ]);
    expect(await outbox.processPendingEvents()).toBe(2);

    // Kafka send failed branch
    prisma.outboxEvent.findMany.mockResolvedValueOnce([
      {
        id: 'e-fail',
        eventType: 'PAYMENT_COMPLETED',
        aggregateId: 'ord-1',
        payload: { a: 1 },
      },
    ]);
    producer.send.mockRejectedValueOnce(new Error('kafka send fail'));
    expect(await outbox.processPendingEvents()).toBe(0);

    // OnModuleInit & Destroy lifecycle
    const originalSetInterval = globalThis.setInterval;
    let relayCallback: (() => void) | undefined;
    globalThis.setInterval = ((callback: () => void) => {
      relayCallback = callback;
      return { unref: jest.fn() } as unknown as NodeJS.Timeout;
    }) as typeof setInterval;

    const producerSpy = jest
      .spyOn(Kafka.prototype, 'producer')
      .mockReturnValue(producer as any);

    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    process.env.KAFKA_ENABLED = 'true';
    await outbox.onModuleInit();
    relayCallback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await outbox.onModuleDestroy();
    process.env.NODE_ENV = origNodeEnv;
    globalThis.setInterval = originalSetInterval;
    producerSpy.mockRestore();

    // PrismaService lifecycle
    const prismaService = new PrismaService();
    prismaService.$connect = jest.fn().mockResolvedValue(undefined);
    prismaService.$disconnect = jest.fn().mockResolvedValue(undefined);
    await prismaService.onModuleInit();
    await prismaService.onModuleDestroy();
  });

  it('covers remaining branches for full Bun coverage', async () => {
    // 1. RedisIdempotencyService: default client instantiation and disconnect on error
    const redisConfig = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'REDIS_ENABLED') return true;
        if (key === 'REDIS_URL') return 'redis://localhost:6379';
        return def;
      }),
    } as any;
    const redisSvc = new RedisIdempotencyService(redisConfig);
    const mockRedisObj = {
      status: 'ready',
      quit: jest.fn().mockRejectedValue(new Error('fail')),
      disconnect: jest.fn(),
    } as any;
    (redisSvc as any).redis = mockRedisObj;
    await redisSvc.onModuleDestroy();
    expect(mockRedisObj.disconnect).toHaveBeenCalled();

    // 2. MidtransService: production URLs, incomplete snap, mock snap, VA without vaNumber
    const prodConfig = {
      get: jest.fn((key: string) => {
        if (key === 'MIDTRANS_SERVER_KEY') return 'test-key';
        if (key === 'MIDTRANS_IS_PRODUCTION') return true;
        return undefined;
      }),
    } as any;
    const prodMidtrans = new MidtransService(prodConfig);
    const post = jest.spyOn(axios, 'post');
    // Snap incomplete response throws BadGatewayException
    post.mockResolvedValueOnce({ data: {} });
    await expect(
      prodMidtrans.createSnapTransaction({
        orderId: 'ORD-INCOMPLETE',
        grossAmount: 100,
      }),
    ).rejects.toThrow('incomplete Snap');

    // VA without va_numbers throws Error
    post.mockResolvedValueOnce({ data: { order_id: '1' } });
    await expect(
      prodMidtrans.createVirtualAccount({
        orderId: 'ORD-NO-VA',
        grossAmount: 100,
        bank: 'bca',
      }),
    ).rejects.toThrow('virtual account number');

    // Mock snap token when server key is not configured
    post.mockResolvedValueOnce({
      data: {
        order_id: 'ORD-QR-PROD',
        transaction_status: 'pending',
        actions: [
          { name: 'generate-qr-code', url: 'https://api.midtrans.com/qr' },
        ],
      },
    });
    await prodMidtrans.createQrTransaction({
      orderId: 'ORD-QR-PROD',
      grossAmount: 100,
    });
    post.mockRejectedValueOnce(new BadGatewayException('bad gateway'));
    await expect(
      prodMidtrans.createQrTransaction({
        orderId: 'ORD-QR-FAIL',
        grossAmount: 100,
      }),
    ).rejects.toThrow('bad gateway');

    const noKeyMidtrans = new MidtransService({
      get: jest.fn((k) => (k === 'MIDTRANS_IS_PRODUCTION' ? false : '')),
    } as any);
    const mockSnap = await noKeyMidtrans.createSnapTransaction({
      orderId: 'ORD-MOCK',
      grossAmount: 100,
    });
    expect(mockSnap.token).toContain('mock-snap');
    post.mockRestore();

    // Status error fallback message
    const get = jest.spyOn(axios, 'get');
    get.mockRejectedValueOnce({ response: {} });
    await expect(prodMidtrans.getTransactionStatus('ERR')).rejects.toThrow(
      'Unknown Midtrans error',
    );
    get.mockRestore();

    // 3. OutboxService: Kafka disabled branch and Kafka connect error
    const outboxPrisma = { outboxEvent: { create: jest.fn() } } as any;
    const outboxConfig = {
      get: jest.fn().mockReturnValue('kafka:29092'),
    } as any;
    const disabledOutbox = new OutboxService(outboxPrisma, outboxConfig);
    const origEnv = process.env.NODE_ENV;
    const origKafka = process.env.KAFKA_ENABLED;
    process.env.NODE_ENV = 'development';
    process.env.KAFKA_ENABLED = 'false';
    await disabledOutbox.onModuleInit();

    // Undefined KAFKA_ENABLED in production (covers line 27)
    delete process.env.KAFKA_ENABLED;
    process.env.NODE_ENV = 'production';
    const prodKafkaOutbox = new OutboxService(outboxPrisma, outboxConfig);
    jest.spyOn(Kafka.prototype, 'producer').mockReturnValueOnce({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    } as any);
    await prodKafkaOutbox.onModuleInit();
    await prodKafkaOutbox.onModuleDestroy();

    // Kafka connect error
    const brokenKafkaOutbox = new OutboxService(outboxPrisma, outboxConfig);
    process.env.KAFKA_ENABLED = 'true';
    jest.spyOn(Kafka.prototype, 'producer').mockReturnValueOnce({
      connect: jest.fn().mockRejectedValue(new Error('broker down')),
      disconnect: jest.fn().mockResolvedValue(undefined),
    } as any);
    await brokenKafkaOutbox.onModuleInit();
    process.env.NODE_ENV = origEnv;
    process.env.KAFKA_ENABLED = origKafka;
    // 4. PaymentsRepository: findCurrentByOrderId latest fallback and listOrders without status
    const repoPrisma = {
      paymentTransaction: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'tx-latest' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ totalCount: 1 }]),
    } as any;
    const repo = new PaymentsRepository(repoPrisma);
    const latest = await repo.findCurrentByOrderId('ORD-FALLBACK');
    expect(latest.id).toBe('tx-latest');
    await repo.listOrders({
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-11-01'),
      page: 1,
      pageSize: 10,
    });

    // 5. PaymentsService: capture branch in sync, VA without expiry
    const mockRepo = {
      findTransactionsForSync: jest.fn().mockResolvedValue([
        {
          id: 'tx-1',
          orderId: 'ORD-1',
          midtransOrderId: 'ORD-1-TX1',
          status: 'PENDING',
          amount: 100,
        },
      ]),
      updateTransactionStatus: jest.fn(),
      withOrderLock: jest.fn((id, cb) => cb({})),
      findSuccessfulByOrderId: jest.fn().mockResolvedValue(null),
      lockStatusForUpdate: jest.fn().mockResolvedValue('PENDING'),
      findPendingByOrderId: jest.fn().mockResolvedValue(null),
      createTransaction: jest.fn().mockResolvedValue({ id: 't' }),
    } as any;
    const mockMidtrans = {
      getTransactionStatus: jest.fn().mockResolvedValue({
        statusCode: '200',
        transactionStatus: 'capture',
        fraudStatus: 'accept',
        transactionId: 't1',
      }),
      createQrTransaction: jest.fn().mockResolvedValue({
        orderId: 'Q',
        transactionStatus: '',
        requestPayload: {},
        rawResponse: {},
      }),
      createVirtualAccount: jest.fn().mockResolvedValue({
        bank: 'bca',
        vaNumber: '1',
        expiryTime: undefined,
        requestPayload: {},
        rawResponse: {},
      }),
    } as any;
    const paymentsSvc = new PaymentsService(
      mockRepo,
      mockMidtrans,
      { findEnabledBank: jest.fn().mockResolvedValue({ code: 'bca' }) } as any,
      { emit: jest.fn() } as any,
      // Partial stub: only the method under test is provided.
      {
        credit: jest.fn().mockResolvedValue({}),
      } as unknown as TenantBalanceService,
    );
    await paymentsSvc.syncPaymentStatus('ORD-1');
    await paymentsSvc.createQrPayment({ orderId: 'ORD-1', amount: 100 });
    await paymentsSvc.createVirtualAccountPayment({
      orderId: 'ORD-1',
      amount: 100,
      bank: 'bca',
    });

    // 6. WebhooksService: settlement webhook without settlement_time
    const webhookPrisma = {
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx',
          status: 'PENDING',
          amount: 100,
          orderId: 'O',
        }),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(webhookPrisma)),
    } as any;
    const webhookSvc = new WebhooksService(
      webhookPrisma,
      { verifySignatureKey: jest.fn().mockReturnValue(true) } as any,
      { emit: jest.fn() } as any,
      // Partial stub: only the method under test is provided.
      {
        findByOrderId: jest.fn(),
        lockStatusForUpdate: jest.fn().mockResolvedValue('PENDING'),
      } as unknown as PaymentsRepository,
      // Partial stub: only the method under test is provided.
      {
        credit: jest.fn().mockResolvedValue({}),
      } as unknown as TenantBalanceService,
    );
    await webhookSvc.handleMidtransWebhook({
      order_id: 'O',
      status_code: '200',
      gross_amount: '100',
      signature_key: 'sig',
      transaction_id: 't',
      transaction_status: 'settlement',
      settlement_time: undefined,
    } as any);
  });
});
