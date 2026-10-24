import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import axios from 'axios';

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

export interface SnapTransactionParams {
  orderId: string;
  grossAmount: number;
  customerDetails?: {
    first_name?: string;
    email?: string;
    phone?: string;
  };
  itemDetails?: Array<{
    id: string;
    price: number;
    quantity: number;
    name: string;
  }>;
}

export interface SnapTransactionResponse {
  token: string;
  redirect_url: string;
  requestPayload: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
}
export interface QrTransactionParams {
  orderId: string;
  grossAmount: number;
  acquirer?: string;
  customerDetails?: {
    first_name?: string;
    email?: string;
    phone?: string;
  };
  itemDetails?: Array<{
    id: string;
    price: number;
    quantity: number;
    name: string;
  }>;
}

export interface QrTransactionResponse {
  transactionId?: string;
  orderId: string;
  transactionStatus: string;
  qrString?: string;
  qrImageUrl?: string;
  acquirer?: string;
  expiryTime?: string;
  requestPayload: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
}

export interface VirtualAccountParams {
  orderId: string;
  grossAmount: number;
  bank: string;
}

export interface VirtualAccountResponse {
  transactionId?: string;
  orderId: string;
  transactionStatus: string;
  bank: string;
  vaNumber: string;
  expiryTime?: string;
  requestPayload: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
}

export interface MidtransTransactionStatusResponse {
  statusCode: string;
  statusMessage?: string;
  transactionId?: string;
  orderId: string;
  grossAmount: string;
  currency?: string;
  paymentType?: string;
  transactionTime?: string;
  transactionStatus: string;
  fraudStatus?: string;
  signatureKey?: string;
  settlementTime?: string;
  rawResponse: Record<string, unknown>;
}

@Injectable()
export class MidtransService {
  private readonly logger = new Logger(MidtransService.name);
  private readonly serverKey: string;
  private readonly isProduction: boolean;
  private readonly snapBaseUrl: string;
  private readonly apiBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.serverKey = this.configService.get<string>('MIDTRANS_SERVER_KEY', '');
    this.isProduction = this.configService.get<boolean>(
      'MIDTRANS_IS_PRODUCTION',
      false,
    );
    this.snapBaseUrl = this.isProduction
      ? 'https://app.midtrans.com/snap/v1'
      : 'https://app.sandbox.midtrans.com/snap/v1';
    this.apiBaseUrl = this.isProduction
      ? 'https://api.midtrans.com/v2'
      : 'https://api.sandbox.midtrans.com/v2';
  }

  async createSnapTransaction(
    params: SnapTransactionParams,
  ): Promise<SnapTransactionResponse> {
    const customerDetails = Object.fromEntries(
      Object.entries(params.customerDetails || {}).filter(
        ([, value]) => value !== undefined,
      ),
    );
    const payload = {
      transaction_details: {
        order_id: params.orderId,
        gross_amount: Math.round(params.grossAmount),
      },
      ...(Object.keys(customerDetails).length > 0
        ? { customer_details: customerDetails }
        : {}),
      ...(params.itemDetails ? { item_details: params.itemDetails } : {}),
    };

    if (!this.serverKey) {
      this.logger.warn(
        'MIDTRANS_SERVER_KEY is not set. Generating mock Snap token for local testing.',
      );
      return {
        token: `mock-snap-token-${params.orderId}`,
        redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/mock-${params.orderId}`,
        requestPayload: payload,
        rawResponse: { mock: true, order_id: params.orderId },
      };
    }

    const authHeader = Buffer.from(`${this.serverKey}:`).toString('base64');

    try {
      const response = await axios.post<SnapTransactionResponse>(
        `${this.snapBaseUrl}/transactions`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Basic ${authHeader}`,
          },
          timeout: 10000,
        },
      );

      if (!response.data.token || !response.data.redirect_url) {
        throw new BadGatewayException(
          'Midtrans returned an incomplete Snap transaction response',
        );
      }

      return {
        ...response.data,
        requestPayload: payload,
        rawResponse: response.data as unknown as Record<string, unknown>,
      };
    } catch (err: unknown) {
      if (err instanceof BadGatewayException) {
        throw err;
      }
      const errorMsg =
        (err as { response?: { data?: unknown } })?.response?.data ||
        (err as Error).message;
      this.logger.error(
        `Failed to create Snap transaction for order ${params.orderId}: ${JSON.stringify(errorMsg)}`,
      );
      throw new BadGatewayException(
        `Midtrans Snap error: ${JSON.stringify(errorMsg)}`,
      );
    }
  }

  async createQrTransaction(
    params: QrTransactionParams,
  ): Promise<QrTransactionResponse> {
    const customerDetails = Object.fromEntries(
      Object.entries(params.customerDetails || {}).filter(
        ([, value]) => value !== undefined,
      ),
    );

    const payload: Record<string, unknown> = {
      payment_type: 'qris',
      transaction_details: {
        order_id: params.orderId,
        gross_amount: Math.round(params.grossAmount),
      },
      qris: {
        acquirer: params.acquirer || 'gopay',
      },
    };

    if (Object.keys(customerDetails).length > 0) {
      payload.customer_details = customerDetails;
    }
    if (params.itemDetails && params.itemDetails.length > 0) {
      payload.item_details = params.itemDetails;
    }

    const chargeBaseUrl = this.isProduction
      ? 'https://api.midtrans.com'
      : 'https://api.sandbox.midtrans.com';

    if (!this.serverKey) {
      this.logger.warn(
        'MIDTRANS_SERVER_KEY is not set. Generating mock QRIS transaction for local testing.',
      );
      return {
        transactionId: `mock-qr-tx-${params.orderId}`,
        orderId: params.orderId,
        transactionStatus: 'pending',
        qrString: `00020101021226590014ID.LINKAJA.WWW01189360091434905263030210G4905263030303UKE51440014ID.CO.QRIS.WWW0215AID0607336128660303UKE5204549953033605802ID5914MOCK MERCHANT6007JAKARTA61051234062200716${params.orderId}6304`,
        qrImageUrl: `${chargeBaseUrl}/v2/qris/mock-${params.orderId}/qr-code`,
        acquirer: params.acquirer || 'gopay',
        expiryTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        requestPayload: payload,
        rawResponse: { mock: true, order_id: params.orderId },
      };
    }

    const authHeader = Buffer.from(`${this.serverKey}:`).toString('base64');

    try {
      const response = await axios.post<{
        transaction_id?: string;
        order_id: string;
        transaction_status: string;
        actions?: Array<{ name: string; method?: string; url: string }>;
        qr_string?: string;
        acquirer?: string;
        expiry_time?: string;
      }>(`${chargeBaseUrl}/v2/charge`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${authHeader}`,
        },
        timeout: 10000,
      });

      const qrAction = response.data.actions?.find(
        (a) =>
          a.name === 'generate-qr-code' || a.name === 'generate-qr-code-v2',
      );
      const qrImageUrl = qrAction?.url ?? response.data.actions?.[0]?.url;

      return {
        transactionId: response.data.transaction_id,
        orderId: response.data.order_id,
        transactionStatus: response.data.transaction_status,
        qrString: response.data.qr_string,
        qrImageUrl,
        acquirer: response.data.acquirer ?? params.acquirer ?? 'gopay',
        expiryTime: response.data.expiry_time,
        requestPayload: payload,
        rawResponse: response.data as unknown as Record<string, unknown>,
      };
    } catch (err: unknown) {
      if (err instanceof BadGatewayException) {
        throw err;
      }
      const errorMsg =
        (err as { response?: { data?: unknown } })?.response?.data ||
        (err as Error).message;
      this.logger.error(
        `Failed to create QRIS transaction for order ${params.orderId}: ${JSON.stringify(errorMsg)}`,
      );
      throw new BadGatewayException(
        `Midtrans QRIS error: ${JSON.stringify(errorMsg)}`,
      );
    }
  }

  async createVirtualAccount(
    params: VirtualAccountParams,
  ): Promise<VirtualAccountResponse> {
    const payload = {
      payment_type: 'bank_transfer',
      transaction_details: {
        order_id: params.orderId,
        gross_amount: Math.round(params.grossAmount),
      },
      bank_transfer: { bank: params.bank },
    };

    if (!this.serverKey) {
      throw new ServiceUnavailableException(
        'Midtrans server key is not configured',
      );
    }

    const authHeader = Buffer.from(`${this.serverKey}:`).toString('base64');

    try {
      const chargeBaseUrl = this.isProduction
        ? 'https://api.midtrans.com'
        : 'https://api.sandbox.midtrans.com';
      const response = await axios.post<{
        transaction_id?: string;
        order_id: string;
        transaction_status: string;
        va_numbers?: Array<{ bank: string; va_number: string }>;
        permata_va_number?: string;
        expiry_time?: string;
      }>(`${chargeBaseUrl}/v2/charge`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${authHeader}`,
        },
        timeout: 10000,
      });
      const va = response.data.va_numbers?.[0];
      const vaNumber = va?.va_number ?? response.data.permata_va_number;
      if (!vaNumber) {
        throw new Error('Midtrans did not return a virtual account number');
      }

      return {
        transactionId: response.data.transaction_id,
        orderId: response.data.order_id,
        transactionStatus: response.data.transaction_status,
        bank: va?.bank ?? params.bank,
        vaNumber,
        expiryTime: response.data.expiry_time,
        requestPayload: payload,
        rawResponse: response.data as unknown as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: unknown } })?.response?.data ||
        (err as Error).message;
      this.logger.error(
        `Failed to create virtual account for order ${params.orderId}: ${JSON.stringify(errorMsg)}`,
      );
      throw new BadGatewayException(
        `Midtrans virtual account error: ${JSON.stringify(errorMsg)}`,
      );
    }
  }

  verifySignatureKey(params: {
    orderId: string;
    statusCode: string;
    grossAmount: string;
    signatureKey: string;
  }): boolean {
    if (!this.serverKey) {
      this.logger.warn(
        'MIDTRANS_SERVER_KEY empty. Bypassing signature verification in dev/test.',
      );
      return true;
    }

    const raw = `${params.orderId}${params.statusCode}${params.grossAmount}${this.serverKey}`;
    const expected = createHash('sha512').update(raw).digest('hex');

    return expected.toLowerCase() === params.signatureKey.toLowerCase();
  }

  async getTransactionStatus(
    midtransOrderId: string,
  ): Promise<MidtransTransactionStatusResponse | null> {
    if (!this.serverKey) {
      this.logger.warn(
        'MIDTRANS_SERVER_KEY is not set. Generating mock transaction status for local testing.',
      );
      return {
        statusCode: '200',
        statusMessage: 'mock status',
        transactionId: `mock-tx-${Date.now()}`,
        orderId: midtransOrderId,
        grossAmount: '100000.00',
        transactionStatus: 'settlement',
        fraudStatus: 'accept',
        paymentType: 'gopay',
        settlementTime: new Date().toISOString(),
        rawResponse: { mock: true },
      };
    }

    const authHeader = Buffer.from(`${this.serverKey}:`).toString('base64');
    const url = `${this.apiBaseUrl}/${midtransOrderId}/status`;

    try {
      const response = await axios.get<Record<string, unknown>>(url, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${authHeader}`,
        },
        timeout: 10000,
      });

      const data = response.data;
      return {
        statusCode: stringValue(data.status_code),
        statusMessage: stringValue(data.status_message) || undefined,
        transactionId: stringValue(data.transaction_id) || undefined,
        orderId: stringValue(data.order_id, midtransOrderId),
        grossAmount: stringValue(data.gross_amount),
        currency: stringValue(data.currency, 'IDR'),
        paymentType: stringValue(data.payment_type) || undefined,
        transactionTime: data.transaction_time as string | undefined,
        transactionStatus: stringValue(data.transaction_status),
        fraudStatus: data.fraud_status as string | undefined,
        signatureKey: data.signature_key as string | undefined,
        settlementTime: data.settlement_time as string | undefined,
        rawResponse: data,
      };
    } catch (err: unknown) {
      const error = err as {
        response?: { status?: number; data?: Record<string, unknown> };
        message?: string;
      };
      if (error.response?.status === 404) {
        this.logger.warn(
          `Transaction ${midtransOrderId} not found in Midtrans`,
        );
        return null;
      }
      const errorMsg =
        error.response?.data?.status_message ||
        error.message ||
        'Unknown Midtrans error';
      this.logger.error(
        `Failed to get transaction status for order ${midtransOrderId}: ${JSON.stringify(errorMsg)}`,
      );
      throw new Error(`Midtrans status error: ${JSON.stringify(errorMsg)}`);
    }
  }
}
