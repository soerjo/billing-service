import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PayoutsService } from './payouts.service.js';
import { RequestPayoutDto } from './dto/request-payout.dto.js';
import { ListPayoutsDto } from './dto/list-payouts.dto.js';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto.js';

@ApiTags('Payouts')
@ApiSecurity('api-key')
@Controller('v1/payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Post()
  @ApiOperation({ summary: 'Request a payout from an organization balance' })
  async requestPayout(@Body() dto: RequestPayoutDto) {
    return this.payoutsService.requestPayout(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payouts for an organization' })
  async listPayouts(@Query() query: ListPayoutsDto) {
    return this.payoutsService.listPayouts({
      organizationId: query.organizationId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payout by id' })
  async getPayoutById(@Param('id') id: string) {
    return this.payoutsService.getPayoutById(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Transition payout status' })
  async updatePayoutStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePayoutStatusDto,
  ) {
    return this.payoutsService.updatePayoutStatus(id, dto.status, dto.reason);
  }
}
