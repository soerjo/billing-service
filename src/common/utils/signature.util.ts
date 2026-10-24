import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface SignaturePayloadInput {
  method: string;
  path: string;
  timestamp: string | number;
  body?: unknown;
}

export function buildPayloadToSign(input: SignaturePayloadInput): string {
  const method = input.method.toUpperCase().trim();
  const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const timestamp = String(input.timestamp);

  let bodyHash = '';
  if (
    input.body !== undefined &&
    input.body !== null &&
    (typeof input.body !== 'object' || Object.keys(input.body).length > 0)
  ) {
    const rawBody =
      typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    bodyHash = createHash('sha256').update(rawBody).digest('hex');
  }

  return `${method}:${path}:${timestamp}:${bodyHash}`;
}

export function generateHmacSignature(
  payloadToSign: string,
  secretKey: string,
): string {
  return createHmac('sha256', secretKey).update(payloadToSign).digest('hex');
}

export function verifyHmacSignature(
  payloadToSign: string,
  secretKey: string,
  providedSignature: string,
): boolean {
  if (!providedSignature || typeof providedSignature !== 'string') {
    return false;
  }

  const expectedSignature = generateHmacSignature(payloadToSign, secretKey);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(providedSignature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
