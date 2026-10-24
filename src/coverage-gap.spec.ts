/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Kafka } from 'kafkajs';
import axios from 'axios';
import { InvoiceStatus, PaymentChannel } from '@prisma/client';
import { InvoicesRepository } from './modules/invoices/invoices.repository.js';
import { InvoicesService } from './modules/invoices/invoices.service.js';
import { MidtransService } from './modules/midtrans/midtrans.service.js';
import { OutboxService } from './modules/outbox/outbox.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { createRequestLoggingMiddleware } from './common/middleware/request-logging.middleware.js';

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
      statusCode: 201,
      on: jest.fn((event: string, callback: () => void) => {
        listeners[event] = callback;
      }),
    } as any;
    const request = {
      path: '/api/invoices',
      method: 'POST',
      originalUrl: '/api/invoices',
      route: { path: '/api/invoices' },
    } as any;
    middleware(request, response, next);
    listeners.finish();
    expect(logger.info).toHaveBeenCalled();
    expect(metrics.recordRequest).toHaveBeenCalledWith(
      'POST',
      '/api/invoices',
      201,
      expect.any(Number),
    );
  });

  it('covers invoice repository operations and status updates', async () => {
    const prisma = {
      billingAccount: { upsert: jest.fn().mockResolvedValue({ id: 'ba' }) },
      invoice: {
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockResolvedValue({ id: 'i' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'i' }),
      },
      paymentTransaction: { create: jest.fn().mockResolvedValue({ id: 't' }) },
    } as any;
    const repository = new InvoicesRepository(prisma);
    await repository.findOrCreateBillingAccount('org');
    await repository.findOrCreateBillingAccount('org', 'Name', 'email');
    await repository.countInvoicesToday(new Date(0), new Date());
    await repository.create({} as any);
    prisma.invoice.findUnique.mockResolvedValueOnce(null);
    await expect(repository.findById('missing')).rejects.toThrow();
    prisma.invoice.findUnique.mockResolvedValueOnce({ id: 'i' });
    await repository.findById('i');
    await repository.findByInvoiceNumber('INV-1');
    await repository.createTransaction({
      invoiceId: 'i',
      midtransOrderId: 'o',
      grossAmount: 1,
    });
    await repository.createTransaction({
      invoiceId: 'i',
      midtransOrderId: 'o',
      grossAmount: 1,
      provider: 'MIDTRANS',
      channel: PaymentChannel.QRIS,
      status: 'PAID',
    });
    await repository.updateInvoiceStatus('i', InvoiceStatus.PAID);
    await repository.updateInvoiceStatus(
      'i',
      InvoiceStatus.UNPAID,
      new Date(0),
      {
        invoice: { update: jest.fn().mockResolvedValue({}) },
      } as any,
    );
    expect(prisma.invoice.update).toHaveBeenCalled();
  });

  it('covers invoice checkout and QR branches', async () => {
    const repository = {
      findOrCreateBillingAccount: jest.fn().mockResolvedValue({ id: 'ba' }),
      countInvoicesToday: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'i', invoiceNumber: 'INV-1' }),
      findById: jest.fn(),
      createTransaction: jest.fn().mockResolvedValue({ id: 'tx' }),
    } as any;
    const midtrans = {
      createSnapTransaction: jest.fn().mockResolvedValue({
        token: 'token',
        redirect_url: 'url',
        requestPayload: {},
        rawResponse: {},
      }),
    } as any;
    const service = new InvoicesService(repository, midtrans);
    await service.createInvoice({
      organizationId: 'org',
      amount: 10,
      dueDate: new Date().toISOString(),
      metadata: { source: 'test' },
    });
    const invoice = {
      id: 'i',
      invoiceNumber: 'INV-1',
      amount: 10,
      description: null,
      status: InvoiceStatus.UNPAID,
      billingAccount: { name: 'Name', email: 'e', phone: null },
    };
    repository.findById.mockResolvedValue(invoice);
    await service.getInvoiceById('i');
    await service.checkoutInvoice('i', { channel: PaymentChannel.QRIS });
    await service.generateQr('i');
    repository.findById.mockResolvedValue({
      ...invoice,
      status: InvoiceStatus.PAID,
    });
    await expect(service.checkoutInvoice('i', {} as any)).rejects.toThrow();
    await expect(service.generateQr('i')).rejects.toThrow();
    repository.findById.mockResolvedValue({
      ...invoice,
      status: InvoiceStatus.VOID,
    });
    await expect(service.checkoutInvoice('i', {} as any)).rejects.toThrow();
    repository.findById.mockResolvedValue({
      ...invoice,
      status: InvoiceStatus.EXPIRED,
    });
    await expect(service.checkoutInvoice('i', {} as any)).rejects.toThrow();
  });

  it('covers Midtrans mock, HTTP success/error, and signatures', async () => {
    const mockConfig = { get: jest.fn().mockReturnValue('') } as any;
    const mock = new MidtransService(mockConfig);
    await mock.createSnapTransaction({ orderId: 'o', grossAmount: 1 });
    expect(
      mock.verifySignatureKey({
        orderId: 'o',
        statusCode: '200',
        grossAmount: '1',
        signatureKey: 'x',
      }),
    ).toBe(true);

    const config = {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'MIDTRANS_SERVER_KEY' ? 'secret' : fallback,
      ),
    } as any;
    const service = new MidtransService(config);
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { token: 't', redirect_url: 'u' },
    });
    await service.createSnapTransaction({ orderId: 'o', grossAmount: 1 });
    post.mockRejectedValueOnce(new Error('network'));
    await expect(
      service.createSnapTransaction({ orderId: 'o', grossAmount: 1 }),
    ).rejects.toThrow('Midtrans Snap error');
    post.mockRestore();
    expect(
      service.verifySignatureKey({
        orderId: 'o',
        statusCode: '200',
        grossAmount: '1',
        signatureKey: 'bad',
      }),
    ).toBe(false);
  });

  it('covers outbox lifecycle, relay branches, and Prisma lifecycle', async () => {
    const updates = jest.fn().mockResolvedValue({});
    const prisma = {
      outboxEvent: {
        create: jest.fn().mockResolvedValue({ id: 'e' }),
        findMany: jest.fn(),
        update: updates,
      },
    } as any;
    const config = { get: jest.fn().mockReturnValue('kafka:29092') } as any;
    const service = new OutboxService(prisma, config);
    await service.emit('Invoice', 'i', 'INVOICE_PAID', { x: 1 });
    await service.emit('Invoice', 'i', 'PAYMENT_FAILED', { x: 1 }, {
      outboxEvent: prisma.outboxEvent,
    } as any);
    prisma.outboxEvent.findMany.mockResolvedValueOnce([]);
    expect(await service.processPendingEvents()).toBe(0);
    prisma.outboxEvent.findMany.mockResolvedValueOnce([
      { id: 'e', eventType: 'UNKNOWN', aggregateId: 'i', payload: {} },
    ]);
    expect(await service.processPendingEvents()).toBe(1);
    const producer = {
      send: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    (service as unknown as { producer: typeof producer }).producer = producer;
    prisma.outboxEvent.findMany.mockResolvedValueOnce([
      { id: 'e2', eventType: 'INVOICE_PAID', aggregateId: 'i', payload: {} },
    ]);
    expect(await service.processPendingEvents()).toBe(1);
    producer.send.mockRejectedValueOnce(new Error('send failed'));
    prisma.outboxEvent.findMany.mockResolvedValueOnce([
      { id: 'e3', eventType: 'PAYMENT_FAILED', aggregateId: 'i', payload: {} },
    ]);
    expect(await service.processPendingEvents()).toBe(0);
    const producerForInit = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
    };
    const producerSpy = jest
      .spyOn(Kafka.prototype, 'producer')
      .mockReturnValue(producerForInit as never);
    const originalSetInterval = globalThis.setInterval;
    let relayCallback: (() => void) | undefined;
    globalThis.setInterval = ((callback: () => void) => {
      relayCallback = callback;
      return { unref: jest.fn() } as unknown as NodeJS.Timeout;
    }) as typeof setInterval;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    await service.onModuleInit();
    relayCallback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await service.onModuleDestroy();
    process.env.NODE_ENV = originalNodeEnv;
    globalThis.setInterval = originalSetInterval;
    producerSpy.mockRestore();

    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    await service.onModuleInit();
    await service.onModuleDestroy();
    process.env.NODE_ENV = original;

    const prismaService = new PrismaService();
    (prismaService as any).$connect = jest.fn().mockResolvedValue(undefined);
    (prismaService as any).$disconnect = jest.fn().mockResolvedValue(undefined);
    await prismaService.onModuleInit();
    await prismaService.onModuleDestroy();
  });
});
