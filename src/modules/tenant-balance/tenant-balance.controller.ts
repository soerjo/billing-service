import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { TenantBalanceService } from './tenant-balance.service.js';
import { ListBalanceMutationsDto } from './dto/list-balance-mutations.dto.js';

@ApiTags('Tenant Balances')
@ApiSecurity('api-key')
@Controller('v1/balances')
export class TenantBalanceController {
  constructor(private readonly tenantBalanceService: TenantBalanceService) {}

  @Get(':organizationId')
  @ApiOperation({ summary: 'Get balance for an organization' })
  getBalance(@Param('organizationId') organizationId: string) {
    return this.tenantBalanceService.getBalance(organizationId);
  }

  @Get(':organizationId/mutations')
  @ApiOperation({ summary: 'List balance mutations for an organization' })
  getMutations(
    @Param('organizationId') organizationId: string,
    @Query() query: ListBalanceMutationsDto,
  ) {
    return this.tenantBalanceService.getMutations(
      organizationId,
      query.page,
      query.limit,
    );
  }
}
