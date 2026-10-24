import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { SKIP_SIGNATURE_KEY } from '../decorators/skip-signature.decorator.js';
import {
  buildPayloadToSign,
  verifyHmacSignature,
} from '../utils/signature.util.js';
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const expectedApiKey = this.configService.get<string>('API_KEY');
    if (!expectedApiKey) {
      if (process.env.NODE_ENV !== 'production') {
        return true;
      }
      throw new UnauthorizedException('API key is not configured');
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      method?: string;
      url?: string;
      originalUrl?: string;
      body?: unknown;
    }>();
    const apiKey =
      request.headers['x-api-key'] ||
      request.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (!apiKey || apiKey !== expectedApiKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    const skipSignature = this.reflector.getAllAndOverride<boolean>(
      SKIP_SIGNATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipSignature) {
      return true;
    }

    const signature = request.headers['x-signature'];
    const timestamp = request.headers['x-timestamp'];

    if (!signature) {
      throw new UnauthorizedException('Missing X-Signature header');
    }
    if (!timestamp) {
      throw new UnauthorizedException('Missing X-Timestamp header');
    }

    const tsNumber = Number(timestamp) || new Date(timestamp).getTime();
    if (!tsNumber || Number.isNaN(tsNumber)) {
      throw new UnauthorizedException('Invalid X-Timestamp header format');
    }

    const timeDiff = Math.abs(Date.now() - tsNumber);
    const maxAgeMs = 5 * 60 * 1000; // 5 minutes
    if (timeDiff > maxAgeMs) {
      throw new UnauthorizedException('Request signature expired');
    }

    const path =
      request.originalUrl?.split('?')[0] || request.url?.split('?')[0] || '/';

    const payloadToSign = buildPayloadToSign({
      method: request.method || 'GET',
      path,
      timestamp,
      body: request.body,
    });

    const isValid = verifyHmacSignature(
      payloadToSign,
      expectedApiKey,
      signature,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid request signature');
    }

    return true;
  }
}
