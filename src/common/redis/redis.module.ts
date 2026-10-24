import { Global, Module } from '@nestjs/common';
import { RedisIdempotencyService } from './redis-idempotency.service.js';
import { IdempotencyInterceptor } from '../interceptors/idempotency.interceptor.js';

@Global()
@Module({
  providers: [RedisIdempotencyService, IdempotencyInterceptor],
  exports: [RedisIdempotencyService, IdempotencyInterceptor],
})
export class RedisModule {}
