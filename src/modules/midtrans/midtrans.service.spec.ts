import { Test, type TestingModule } from '@nestjs/testing';
import { MidtransService } from './midtrans.service.js';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { ServiceUnavailableException } from '@nestjs/common';
describe('MidtransService', () => {
  let service: MidtransService;

  const serverKey = 'SB-Mid-server-testkey12345';

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: unknown) => {
      if (key === 'MIDTRANS_SERVER_KEY') return serverKey;
      if (key === 'MIDTRANS_IS_PRODUCTION') return false;
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MidtransService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MidtransService>(MidtransService);
  });

  describe('verifySignatureKey', () => {
    it('returns true when SHA512 matches orderId + statusCode + grossAmount + serverKey', () => {
      const orderId = 'INV-20261020-0001-TX1';
      const statusCode = '200';
      const grossAmount = '150000.00';
      const validSignature = createHash('sha512')
        .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
        .digest('hex');

      const isValid = service.verifySignatureKey({
        orderId,
        statusCode,
        grossAmount,
        signatureKey: validSignature,
      });

      expect(isValid).toBe(true);
    });

    it('returns false when signature does not match', () => {
      const isValid = service.verifySignatureKey({
        orderId: 'INV-20261020-0001-TX1',
        statusCode: '200',
        grossAmount: '150000.00',
        signatureKey: 'tampered-signature-invalid',
      });

      expect(isValid).toBe(false);
    });
  });

  it('returns a service-unavailable error when VA credentials are missing', async () => {
    const serviceWithoutKey = new MidtransService({
      get: jest.fn((key: string) =>
        key === 'MIDTRANS_SERVER_KEY' ? '' : false,
      ),
    } as unknown as ConfigService);

    await expect(
      serviceWithoutKey.createVirtualAccount({
        orderId: 'ORD-NO-KEY',
        grossAmount: 100000,
        bank: 'bca',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns a mock QRIS transaction when server key is not configured', async () => {
    const serviceWithoutKey = new MidtransService({
      get: jest.fn((key: string) =>
        key === 'MIDTRANS_SERVER_KEY' ? '' : false,
      ),
    } as unknown as ConfigService);

    const res = await serviceWithoutKey.createQrTransaction({
      orderId: 'ORD-MOCK-QR',
      grossAmount: 50000,
    });

    expect(res.orderId).toBe('ORD-MOCK-QR');
    expect(res.qrString).toBeDefined();
    expect(res.qrImageUrl).toContain('/v2/qris/mock-ORD-MOCK-QR/qr-code');
  });
});
