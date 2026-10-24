import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from '../interceptors/idempotency.interceptor.js';

export type IdempotentKeySelector =
  string | ((request: Record<string, unknown>) => string | undefined | null);

export interface IdempotentOptions {
  /**
   * Field name in request body/params or a function extracting the key.
   * Defaults to 'orderId'.
   * Examples: 'orderId', 'invoiceId', 'userId', or (req) => req.params.id
   */
  keyField?: IdempotentKeySelector;

  /**
   * Custom namespace/scope for the Redis key.
   * If omitted, defaults to the controller name.
   */
  scope?: string;

  /**
   * Cache TTL in seconds. Defaults to REDIS_IDEMPOTENCY_TTL_SECONDS (60).
   */
  ttl?: number;

  /**
   * Distributed lock TTL in milliseconds. Defaults to 30000 (30s).
   */
  lockTtlMs?: number;
}

export const IDEMPOTENT_OPTIONS_KEY = 'IDEMPOTENT_OPTIONS';

export function Idempotent(options?: IdempotentOptions) {
  return applyDecorators(
    SetMetadata(IDEMPOTENT_OPTIONS_KEY, options || {}),
    UseInterceptors(IdempotencyInterceptor),
  );
}
