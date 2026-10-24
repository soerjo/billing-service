import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service.js';
import { CreateSnapPaymentDto } from './dto/create-snap-payment.dto.js';
import { CreateQrPaymentDto } from './dto/create-qr-payment.dto.js';
import { CreateVaPaymentDto } from './dto/create-va-payment.dto.js';
import { SyncPaymentsDto } from './dto/sync-payments.dto.js';
import { ListPaymentOrdersDto } from './dto/list-payment-orders.dto.js';
import { ListPaymentOrdersResponseDto } from './dto/list-payment-orders-response.dto.js';

@ApiTags('Payments')
@ApiSecurity('api-key')
@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('snap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate Midtrans Snap payment checkout' })
  async createSnapPayment(@Body() dto: CreateSnapPaymentDto) {
    return this.paymentsService.createSnapPayment(dto);
  }

  @Post('qr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate QRIS payment code for an order' })
  async createQrPayment(@Body() dto: CreateQrPaymentDto) {
    return this.paymentsService.createQrPayment(dto);
  }

  @Post('virtual-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a Midtrans bank virtual account for an order',
  })
  async createVirtualAccountPayment(@Body() dto: CreateVaPaymentDto) {
    return this.paymentsService.createVirtualAccountPayment(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List latest payment transaction per external order',
  })
  @ApiOkResponse({ type: ListPaymentOrdersResponseDto })
  async listPaymentOrders(@Query() query: ListPaymentOrdersDto) {
    return this.paymentsService.listPaymentOrders(query);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Batch sync transaction statuses with Midtrans (specific orderIds or all unsettled)',
  })
  @ApiBody({
    type: SyncPaymentsDto,
    required: false,
    description:
      'Optional list of order IDs to sync. If omitted or empty, all unsettled transactions are synced.',
  })
  async syncBatch(@Body() dto?: SyncPaymentsDto) {
    return this.paymentsService.syncBatch(dto);
  }

  @Post(':orderId/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync and reconcile transaction status with Midtrans for an order',
  })
  async syncPaymentStatus(@Param('orderId') orderId: string) {
    return this.paymentsService.syncPaymentStatus(orderId);
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get current payment status for an order' })
  async getPaymentStatus(@Param('orderId') orderId: string) {
    return this.paymentsService.getPaymentStatus(orderId);
  }

  @Get(':orderId/transactions')
  @ApiOperation({ summary: 'Get payment attempt transactions for an order' })
  async getPaymentTransactions(@Param('orderId') orderId: string) {
    return this.paymentsService.getPaymentTransactions(orderId);
  }
}
