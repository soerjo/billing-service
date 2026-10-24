import {
  buildPayloadToSign,
  generateHmacSignature,
  verifyHmacSignature,
} from './signature.util.js';

describe('signature.util', () => {
  const secretKey = 'my-secret-key';

  describe('buildPayloadToSign', () => {
    it('builds payload with empty body', () => {
      const payload = buildPayloadToSign({
        method: 'get',
        path: 'api/v1/payments',
        timestamp: '1729778400000',
      });
      expect(payload).toBe('GET:/api/v1/payments:1729778400000:');
    });

    it('builds payload with JSON object body', () => {
      const payload = buildPayloadToSign({
        method: 'POST',
        path: '/api/v1/payments/snap',
        timestamp: '1729778400000',
        body: { orderId: 'ORD-1' },
      });
      expect(payload).toContain('POST:/api/v1/payments/snap:1729778400000:');
      expect(payload.length).toBeGreaterThan(45);
    });

    it('builds payload with string body', () => {
      const payload = buildPayloadToSign({
        method: 'post',
        path: '/api/v1/payments/snap',
        timestamp: '1729778400000',
        body: '{"raw":"string"}',
      });
      expect(payload).toContain('POST:/api/v1/payments/snap:1729778400000:');
    });
  });

  describe('generateHmacSignature and verifyHmacSignature', () => {
    it('generates and verifies valid signature', () => {
      const payload = 'GET:/api/v1/payments:1729778400000:';
      const sig = generateHmacSignature(payload, secretKey);
      expect(verifyHmacSignature(payload, secretKey, sig)).toBe(true);
    });

    it('rejects tampered signature', () => {
      const payload = 'GET:/api/v1/payments:1729778400000:';
      const sig = generateHmacSignature(payload, secretKey);
      const tampered = sig.slice(0, -4) + '0000';
      expect(verifyHmacSignature(payload, secretKey, tampered)).toBe(false);
    });

    it('rejects empty or non-string signature', () => {
      const payload = 'GET:/api/v1/payments:1729778400000:';
      expect(verifyHmacSignature(payload, secretKey, '')).toBe(false);
      expect(verifyHmacSignature(payload, secretKey, null as never)).toBe(
        false,
      );
    });

    it('rejects signature with wrong length', () => {
      const payload = 'GET:/api/v1/payments:1729778400000:';
      expect(verifyHmacSignature(payload, secretKey, 'short')).toBe(false);
    });
  });
});
