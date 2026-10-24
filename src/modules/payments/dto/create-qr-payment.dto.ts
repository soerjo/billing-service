import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateQrPaymentDto {
  @ApiProperty({
    example: 'ORD-20261024-0001',
    description: 'External order/invoice reference from calling service',
  })
  @IsString()
  orderId!: string;

  @ApiProperty({ example: 150000, description: 'Amount in IDR', minimum: 1 })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: 'IDR', default: 'IDR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Customer name' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    example: 'john@example.com',
    description: 'Customer email',
  })
  @IsOptional()
  @IsString()
  customerEmail?: string;

  @ApiPropertyOptional({
    example: 'QRIS payment',
    description: 'Payment description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: { planId: 'plan-pro' },
    description: 'Arbitrary context metadata',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
