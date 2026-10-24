import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaymentStatus } from '@prisma/client';

export const PAYMENT_STATUSES = Object.values(PaymentStatus);
export class ListPaymentOrdersDto {
  @ApiProperty({
    example: '2026-10-01T00:00:00.000Z',
    description: 'Inclusive start of createdAt range',
  })
  @IsDateString()
  startDate!: string;

  @ApiProperty({
    example: '2026-11-01T00:00:00.000Z',
    description: 'Exclusive end of createdAt range',
  })
  @IsDateString()
  endDate!: string;
  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Filter by latest payment status',
  })
  @IsOptional()
  @IsString()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;

  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    type: 'integer',
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}
