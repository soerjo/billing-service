import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const RELEASE_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

@Injectable()
export class RedisIdempotencyService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisIdempotencyService.name);
  private readonly enabled: boolean;
  private readonly redis?: Redis;
  private readonly ttlSeconds: number;
  private readonly lockTtlMs = 30000;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) injectedClient?: Redis,
  ) {
    this.enabled = this.configService.get<boolean>('REDIS_ENABLED', true);
    this.ttlSeconds = Number(
      this.configService.get<number>('REDIS_IDEMPOTENCY_TTL_SECONDS', 60),
    );
    if (injectedClient) {
      this.redis = injectedClient;
    } else if (this.enabled) {
      this.redis = new Redis(
        this.configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
        {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        },
      );
    }
  }

  async execute<T>(
    scope: string,
    orderId: string,
    payload: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!orderId?.trim()) {
      throw new ConflictException('Order ID is required');
    }
    if (!this.enabled || !this.redis) {
      throw new ServiceUnavailableException(
        'Redis idempotency service is not available',
      );
    }

    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const responseKey = `idempotency:${scope}:${orderId}:${payloadHash}`;
    const lockKey = `${responseKey}:lock`;
    const lockToken = randomUUID();

    await this.connect();

    const stored = await this.redis.get(responseKey);
    if (stored) {
      return JSON.parse(stored) as T;
    }

    const acquired = await this.redis.set(
      lockKey,
      lockToken,
      'PX',
      this.lockTtlMs,
      'NX',
    );
    if (acquired !== 'OK') {
      throw new ConflictException(
        'Another payment request for this order is currently in progress',
      );
    }

    try {
      const response = await operation();
      await this.redis.set(
        responseKey,
        JSON.stringify(response),
        'EX',
        this.ttlSeconds,
      );
      return response;
    } finally {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken);
    }
  }

  private async connect() {
    if (!this.redis || this.redis.status === 'ready') {
      return;
    }
    try {
      await this.redis.connect();
    } catch (error) {
      this.logger.error(
        `Unable to connect to Redis: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Redis idempotency service is not available',
      );
    }
  }

  async onModuleDestroy() {
    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }
}
