import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import {
  IDEMPOTENT_OPTIONS_KEY,
  IdempotentOptions,
} from '../decorators/idempotent.decorator.js';
import { RedisIdempotencyService } from '../redis/redis-idempotency.service.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisIdempotency: RedisIdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options =
      this.reflector.get<IdempotentOptions>(
        IDEMPOTENT_OPTIONS_KEY,
        context.getHandler(),
      ) || {};

    const request = context.switchToHttp().getRequest<{
      body?: Record<string, unknown>;
      params?: Record<string, string>;
      query?: Record<string, string>;
    }>();

    const entityKey = this.resolveEntityKey(request, options.keyField);
    if (!entityKey) {
      throw new ConflictException(
        `Idempotency key could not be resolved from request (target field: '${String(
          options.keyField || 'orderId',
        )}')`,
      );
    }

    const scope =
      options.scope ||
      context
        .getClass()
        .name.replace(/Controller$/, '')
        .toLowerCase();

    return from(
      this.redisIdempotency.execute(
        scope,
        entityKey,
        request.body || {},
        () => firstValueFrom(next.handle()),
        options.ttl,
      ),
    );
  }

  private resolveEntityKey(
    request: {
      body?: Record<string, unknown>;
      params?: Record<string, string>;
      query?: Record<string, string>;
    },
    keyField?: IdempotentOptions['keyField'],
  ): string | undefined {
    const toCleanString = (v: unknown): string | undefined => {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
      return undefined;
    };

    if (typeof keyField === 'function') {
      return toCleanString(keyField(request));
    }

    if (typeof keyField === 'string' && keyField.trim()) {
      const target = keyField.trim();
      const val =
        request.body?.[target] ??
        request.params?.[target] ??
        request.query?.[target];
      return toCleanString(val);
    }

    const fallback =
      request.body?.orderId ??
      request.params?.orderId ??
      request.body?.id ??
      request.params?.id;

    return toCleanString(fallback);
  }
}
