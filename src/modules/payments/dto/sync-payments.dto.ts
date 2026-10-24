import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class SyncPaymentsDto {
  @ApiPropertyOptional({
    example: ['ORD-20261024-0001', 'ORD-20261024-0002'],
    description:
      'List of external order IDs to sync. If omitted, all unsettled transactions will be synced.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  orderIds?: string[];
}
