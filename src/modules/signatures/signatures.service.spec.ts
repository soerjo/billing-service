import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { SignaturesService } from './signatures.service.js';

describe('SignaturesService', () => {
  let service: SignaturesService;
  const mockApiKey = 'test-secret-api-key';

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'API_KEY') return mockApiKey;
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignaturesService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SignaturesService>(SignaturesService);
  });

  it('generates signature and headers with explicit timestamp and body', () => {
    const res = service.generateSignature({
      method: 'POST',
      path: '/api/v1/payments/snap',
      timestamp: '2026-10-24T14:00:00.000Z',
      body: { orderId: 'ORD-1', amount: 150000 },
    });

    expect(res.signature).toBeDefined();
    expect(res.timestamp).toBe('2026-10-24T14:00:00.000Z');
    expect(res.payloadToSign).toContain(
      'POST:/api/v1/payments/snap:2026-10-24T14:00:00.000Z:',
    );
    expect(res.headers['X-Api-Key']).toBe(mockApiKey);
    expect(res.headers['X-Signature']).toBe(res.signature);
    expect(res.headers['X-Timestamp']).toBe('2026-10-24T14:00:00.000Z');
  });

  it('generates signature with auto-timestamp when timestamp is omitted', () => {
    const res = service.generateSignature({
      method: 'GET',
      path: '/api/v1/payments/ORD-1',
    });

    expect(res.signature).toBeDefined();
    expect(res.timestamp).toBeDefined();
    expect(res.headers['X-Signature']).toBe(res.signature);
  });

  it('uses apiKeyOverride when passed', () => {
    const res = service.generateSignature(
      { method: 'GET', path: '/api/v1/payments' },
      'custom-override-key',
    );

    expect(res.headers['X-Api-Key']).toBe('custom-override-key');
  });

  it('throws UnauthorizedException when API key is not configured', () => {
    mockConfigService.get.mockReturnValueOnce(undefined);
    expect(() =>
      service.generateSignature({ method: 'GET', path: '/test' }),
    ).toThrow(UnauthorizedException);
  });
});
