import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PaymentMethodsService } from './payment-methods.service.js';

@ApiTags('Payment Methods')
@ApiSecurity('api-key')
@Controller('v1/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Get('virtual-account')
  @ApiOperation({ summary: 'List enabled virtual account banks' })
  listVirtualAccountBanks() {
    return this.paymentMethodsService.listEnabledVirtualAccountBanks();
  }
}
