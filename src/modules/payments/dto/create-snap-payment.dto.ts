import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentChannel } from '@prisma/client';

export class CreateSnapPaymentDto {
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

  @ApiPropertyOptional({
    enum: PaymentChannel,
    default: PaymentChannel.SNAP_ALL,
    description: 'Preferred payment channel',
  })
  @IsOptional()
  @IsEnum(PaymentChannel)
  channel?: PaymentChannel;

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
    example: '081234567890',
    description: 'Customer phone number',
  })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({
    example: 'Subscription payment',
    description: 'Payment description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: { planId: 'plan-pro', userId: 'user-123' },
    description: 'Arbitrary context metadata',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 'org-123',
    description:
      'Owning organization; settled amount is credited to its balance',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;
}
