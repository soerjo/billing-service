import { Test, type TestingModule } from '@nestjs/testing';
import { OutboxService } from './outbox.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';

describe('OutboxService', () => {
  let service: OutboxService;

  const mockPrisma = {
    outboxEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OutboxService>(OutboxService);
  });

  it('emits an outbox event to database', async () => {
    mockPrisma.outboxEvent.create.mockResolvedValue({ id: 'outbox-1' });

    const result = await service.emit('PAYMENT', 'ord-1', 'PAYMENT_COMPLETED', {
      amount: 150000,
    });

    expect(result).toEqual({ id: 'outbox-1' });
    expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateType: 'PAYMENT',
        aggregateId: 'ord-1',
        eventType: 'PAYMENT_COMPLETED',
        status: 'PENDING',
      }) as unknown,
    });
  });

  it('processes pending events via fallback when kafka is not connected', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        aggregateType: 'PAYMENT',
        aggregateId: 'ord-1',
        eventType: 'PAYMENT_COMPLETED',
        payload: { amount: 150000 },
      },
    ]);
    mockPrisma.outboxEvent.update.mockResolvedValue({ id: 'outbox-1' });

    const processed = await service.processPendingEvents();

    expect(processed).toBe(1);
    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: expect.objectContaining({ status: 'PROCESSED' }) as unknown,
    });
  });
});
