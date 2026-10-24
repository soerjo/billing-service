import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service.js';
import { SalesReportQueryDto } from './dto/sales-report-query.dto.js';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('v1/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @ApiOperation({
    summary: 'Get comprehensive sales and revenue financial report',
  })
  async getSalesReport(@Query() query: SalesReportQueryDto) {
    return this.reportsService.getSalesReport(query);
  }
}
