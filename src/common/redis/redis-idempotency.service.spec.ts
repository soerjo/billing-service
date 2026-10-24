import { createHash } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  RedisIdempotencyService,
  REDIS_CLIENT,
} from './redis-idempotency.service.js';

const makeMockRedis = () => ({
  status: 'ready' as string,
  get: jest.fn<Promise<string | null>, [string]>(),
  set: jest.fn<Promise<string | null>, unknown[]>(),
  eval: jest.fn<Promise<number>, unknown[]>(),
  quit: jest.fn<Promise<'OK'>, []>(),
  connect: jest.fn<Promise<void>, []>(),
});

describe('RedisIdempotencyService', () => {
  let service: RedisIdempotencyService;
  let mockRedis: ReturnType<typeof makeMockRedis>;

  const makeService = async (
    configOverrides: Record<string, unknown> = {},
    redis?: ReturnType<typeof makeMockRedis>,
  ) => {
    const defaults = {
      REDIS_ENABLED: true,
      REDIS_URL: 'redis://localhost:6379',
    };
    const providers = [
      RedisIdempotencyService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn(
            (key: string, fallback?: unknown) =>
              (
                ({ ...defaults, ...configOverrides }) as Record<string, unknown>
              )[key] ?? fallback,
          ),
        },
      },
    ];
    if (redis) {
      providers.push({ provide: REDIS_CLIENT, useValue: redis } as never);
    }
    const module = await Test.createTestingModule({ providers }).compile();
    return module.get<RedisIdempotencyService>(RedisIdempotencyService);
  };

  const fp = (request: unknown) =>
    createHash('sha256').update(JSON.stringify(request)).digest('hex');

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis = makeMockRedis();
    service = await makeService({}, mockRedis);
  });

  afterEach(async () => {
    mockRedis.quit.mockResolvedValue('OK');
    await service.onModuleDestroy();
  });

  describe('execute', () => {
    it('rejects when orderId is empty', async () => {
      await expect(
        service.execute('snap', '', {}, () => Promise.resolve('ok')),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when Redis is disabled (no client injected)', async () => {
      const disabled = await makeService({ REDIS_ENABLED: false });
      await expect(
        disabled.execute('snap', 'ORD-1', {}, () => Promise.resolve('ok')),
      ).rejects.toThrow(ServiceUnavailableException);
      await disabled.onModuleDestroy();
    });

    it('calls operation and stores response on cache miss using orderId and payload hash', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValueOnce('OK'); // lock acquired
      mockRedis.set.mockResolvedValueOnce('OK'); // response stored
      mockRedis.eval.mockResolvedValue(1);

      const payload = { orderId: 'ORD-1', amount: 150000 };
      const result = await service.execute('snap', 'ORD-1', payload, () =>
        Promise.resolve({ transactionId: 'tx-1' }),
      );

      expect(result).toEqual({ transactionId: 'tx-1' });
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
      const expectedKey = `idempotency:snap:ORD-1:${fp(payload)}`;
      expect(mockRedis.get).toHaveBeenCalledWith(expectedKey);
      expect(mockRedis.set).toHaveBeenNthCalledWith(
        2,
        expectedKey,
        JSON.stringify({ transactionId: 'tx-1' }),
        'EX',
        60,
      );
    });

    it('returns cached response on cache hit with same orderId and payload', async () => {
      const payload = { orderId: 'ORD-HIT', amount: 100000 };
      const cached = { transactionId: 'tx-cached', status: 'PENDING' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const operation = jest.fn();
      const result = await service.execute(
        'snap',
        'ORD-HIT',
        payload,
        operation,
      );

      expect(result).toEqual(cached);
      expect(operation).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
      const expectedKey = `idempotency:snap:ORD-HIT:${fp(payload)}`;
      expect(mockRedis.get).toHaveBeenCalledWith(expectedKey);
    });

    it('rejects when lock is already held (concurrent duplicate request)', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(null); // NX not acquired

      await expect(
        service.execute('snap', 'ORD-LOCKED', {}, () => Promise.resolve('ok')),
      ).rejects.toThrow(ConflictException);
    });

    it('releases lock even when operation throws', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.eval.mockResolvedValue(1);

      await expect(
        service.execute('snap', 'ORD-THROWS', {}, () =>
          Promise.reject(new Error('op failed')),
        ),
      ).rejects.toThrow('op failed');

      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it('throws ServiceUnavailableException when Redis connect fails', async () => {
      mockRedis.status = 'wait';
      mockRedis.connect.mockRejectedValue(new Error('ECONNREFUSED'));
      mockRedis.get.mockResolvedValue(null);

      await expect(
        service.execute('snap', 'ORD-NO-REDIS', {}, () =>
          Promise.resolve('ok'),
        ),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('skips connect() when status is already ready', async () => {
      mockRedis.status = 'ready';
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce('OK');
      mockRedis.eval.mockResolvedValue(1);

      await service.execute('snap', 'ORD-READY', {}, () =>
        Promise.resolve('done'),
      );

      expect(mockRedis.connect).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('calls quit on the Redis client', async () => {
      mockRedis.quit.mockResolvedValue('OK');
      await service.onModuleDestroy();
      expect(mockRedis.quit).toHaveBeenCalled();
    });

    it('does nothing when Redis is disabled', async () => {
      const disabled = await makeService({ REDIS_ENABLED: false });
      await expect(disabled.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
