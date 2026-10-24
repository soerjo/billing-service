import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InvoicesRepository } from './invoices.repository.js';
import { MidtransService } from '../midtrans/midtrans.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { CheckoutInvoiceDto } from './dto/checkout-invoice.dto.js';
import { InvoiceStatus, PaymentChannel, Prisma } from '@prisma/client';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly midtransService: MidtransService,
  ) {}

  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${year}${month}${day}`;

    const startOfDay = new Date(year, now.getMonth(), now.getDate());
    const endOfDay = new Date(year, now.getMonth(), now.getDate() + 1);

    const count = await this.invoicesRepository.countInvoicesToday(
      startOfDay,
      endOfDay,
    );
    const sequence = String(count + 1).padStart(4, '0');

    return `INV-${datePrefix}-${sequence}`;
  }

  async createInvoice(dto: CreateInvoiceDto) {
    const billingAccount =
      await this.invoicesRepository.findOrCreateBillingAccount(
        dto.organizationId,
      );

    const invoiceNumber = await this.generateInvoiceNumber();

    const invoice = await this.invoicesRepository.create({
      billingAccountId: billingAccount.id,
      invoiceNumber,
      amount: new Prisma.Decimal(dto.amount),
      dueDate: new Date(dto.dueDate),
      description: dto.description ?? null,
      metadata: (dto.metadata as Prisma.InputJsonValue) ?? null,
      status: InvoiceStatus.UNPAID,
    });

    this.logger.log(`Created invoice ${invoice.invoiceNumber} (${invoice.id})`);
    return invoice;
  }

  async getInvoiceById(id: string) {
    return this.invoicesRepository.findById(id);
  }

  async checkoutInvoice(id: string, dto: CheckoutInvoiceDto) {
    const invoice = await this.invoicesRepository.findById(id);

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already PAID');
    }

    if (
      invoice.status === InvoiceStatus.VOID ||
      invoice.status === InvoiceStatus.EXPIRED
    ) {
      throw new BadRequestException(
        `Cannot checkout invoice with status ${invoice.status}`,
      );
    }

    const txSuffix = Date.now().toString().slice(-4);
    const midtransOrderId = `${invoice.invoiceNumber}-TX${txSuffix}`;

    const snapResult = await this.midtransService.createSnapTransaction({
      orderId: midtransOrderId,
      grossAmount: Number(invoice.amount),
      customerDetails: {
        first_name: invoice.billingAccount.name,
        email: invoice.billingAccount.email,
        phone: invoice.billingAccount.phone || undefined,
      },
      itemDetails: [
        {
          id: invoice.id,
          name: invoice.description || `Invoice ${invoice.invoiceNumber}`,
          price: Math.round(Number(invoice.amount)),
          quantity: 1,
        },
      ],
    });

    const transaction = await this.invoicesRepository.createTransaction({
      invoiceId: invoice.id,
      midtransOrderId,
      grossAmount: invoice.amount,
      channel: dto.channel || PaymentChannel.SNAP_ALL,
      snapToken: snapResult.token,
      snapRedirectUrl: snapResult.redirect_url,
      requestPayload:
        snapResult.requestPayload as unknown as Prisma.InputJsonValue,
      rawResponse: snapResult.rawResponse as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
    });

    return {
      transactionId: transaction.id,
      midtransOrderId,
      grossAmount: Number(invoice.amount),
      snapToken: snapResult.token,
      snapRedirectUrl: snapResult.redirect_url,
    };
  }

  async generateQr(id: string) {
    const invoice = await this.invoicesRepository.findById(id);

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already PAID');
    }

    const txSuffix = Date.now().toString().slice(-4);
    const midtransOrderId = `${invoice.invoiceNumber}-QR${txSuffix}`;
    const grossAmount = Math.round(Number(invoice.amount));

    // Request Snap or direct QR from Midtrans
    const snapResult = await this.midtransService.createSnapTransaction({
      orderId: midtransOrderId,
      grossAmount,
      customerDetails: {
        first_name: invoice.billingAccount.name,
        email: invoice.billingAccount.email,
        phone: invoice.billingAccount.phone || undefined,
      },
      itemDetails: [
        {
          id: invoice.id,
          name: invoice.description || `Invoice ${invoice.invoiceNumber}`,
          price: grossAmount,
          quantity: 1,
        },
      ],
    });

    // Simulated / fallback standard QRIS string format for POS devices
    const qrString = `00020101021226620014ID.LINKAJA.WWW01189360091434905263030210G4905263030303UKE51440014ID.CO.QRIS.WWW0215AID0607336128660303UKE5204549953033605802ID5914SOERJO POS PAY6007JAKARTA61051234062200716${midtransOrderId}6304`;
    const qrImageUrl = `https://api.sandbox.midtrans.com/v2/qris/${midtransOrderId}/qr-code`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await this.invoicesRepository.createTransaction({
      invoiceId: invoice.id,
      midtransOrderId,
      grossAmount: invoice.amount,
      channel: PaymentChannel.QRIS,
      snapToken: snapResult.token,
      snapRedirectUrl: snapResult.redirect_url,
      requestPayload:
        snapResult.requestPayload as unknown as Prisma.InputJsonValue,
      rawResponse: snapResult.rawResponse as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
    });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      grossAmount,
      qrString,
      qrImageUrl,
      expiresAt,
      status: 'PENDING',
    };
  }
}
