import { ConflictException, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  const mockReflector = {
    get: jest.fn(),
  };
  const mockRedisIdempotency = {
    execute: jest.fn(
      async (
        _scope: string,
        _key: string,
        _req: unknown,
        operation: () => Promise<unknown>,
      ) => operation(),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new IdempotencyInterceptor(
      mockReflector as never,
      mockRedisIdempotency as never,
    );
  });

  class SampleController {}

  const makeContext = (req: Record<string, unknown> = {}) =>
    ({
      getHandler: jest.fn(),
      getClass: () => SampleController,
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    }) as unknown as ExecutionContext;

  const mockNext = {
    handle: () => of({ success: true }),
  };

  it('resolves key from body with string keyField and uses custom scope and ttl', async () => {
    mockReflector.get.mockReturnValue({
      keyField: 'invoiceId',
      scope: 'custom-scope',
      ttl: 120,
    });

    const context = makeContext({
      body: { invoiceId: 'INV-123', amount: 500 },
    });
    const res = await interceptor.intercept(context, mockNext).toPromise();

    expect(res).toEqual({ success: true });
    expect(mockRedisIdempotency.execute).toHaveBeenCalledWith(
      'custom-scope',
      'INV-123',
      { invoiceId: 'INV-123', amount: 500 },
      expect.any(Function),
      120,
    );
  });

  it('resolves key from params or query with string keyField', async () => {
    mockReflector.get.mockReturnValue({ keyField: 'orderId' });

    const contextWithParams = makeContext({ params: { orderId: 'ORD-PARAM' } });
    await interceptor.intercept(contextWithParams, mockNext).toPromise();
    expect(mockRedisIdempotency.execute).toHaveBeenCalledWith(
      'sample',
      'ORD-PARAM',
      {},
      expect.any(Function),
      undefined,
    );

    const contextWithQuery = makeContext({ query: { orderId: 'ORD-QUERY' } });
    await interceptor.intercept(contextWithQuery, mockNext).toPromise();
    expect(mockRedisIdempotency.execute).toHaveBeenCalledWith(
      'sample',
      'ORD-QUERY',
      {},
      expect.any(Function),
      undefined,
    );
  });

  it('resolves key via function selector', async () => {
    mockReflector.get.mockReturnValue({
      keyField: (req: Record<string, unknown>) =>
        (req.headers as Record<string, string>)?.['x-custom-id'],
    });

    const context = makeContext({
      headers: { 'x-custom-id': 'custom-header-id' },
    });
    await interceptor.intercept(context, mockNext).toPromise();

    expect(mockRedisIdempotency.execute).toHaveBeenCalledWith(
      'sample',
      'custom-header-id',
      {},
      expect.any(Function),
      undefined,
    );
  });

  it('resolves key with default fallbacks (orderId / id in body or params)', async () => {
    mockReflector.get.mockReturnValue({});

    // body.orderId
    await interceptor
      .intercept(makeContext({ body: { orderId: 'O-1' } }), mockNext)
      .toPromise();
    expect(mockRedisIdempotency.execute).toHaveBeenCalledWith(
      'sample',
      'O-1',
      { orderId: 'O-1' },
      expect.any(Function),
      undefined,
    );

    // body.id
    await interceptor
      .intercept(makeContext({ body: { id: 'ID-1' } }), mockNext)
      .toPromise();
    expect(mockRedisIdempotency.execute).toHaveBeenCalledWith(
      'sample',
      'ID-1',
      { id: 'ID-1' },
      expect.any(Function),
      undefined,
    );

    // params.id
    await interceptor
      .intercept(makeContext({ params: { id: 'PID-1' } }), mockNext)
      .toPromise();
    expect(mockRedisIdempotency.execute).toHaveBeenCalledWith(
      'sample',
      'PID-1',
      {},
      expect.any(Function),
      undefined,
    );
  });

  it('throws ConflictException when key cannot be resolved', () => {
    mockReflector.get.mockReturnValue({ keyField: 'transactionId' });

    const context = makeContext({ body: {} });
    expect(() => interceptor.intercept(context, mockNext)).toThrow(
      ConflictException,
    );
  });
});
