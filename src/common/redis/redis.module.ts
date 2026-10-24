import { Global, Module } from '@nestjs/common';
import { RedisIdempotencyService } from './redis-idempotency.service.js';

@Global()
@Module({
  providers: [RedisIdempotencyService],
  exports: [RedisIdempotencyService],
})
export class RedisModule {}
