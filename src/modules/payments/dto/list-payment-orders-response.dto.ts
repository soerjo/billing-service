import { ApiProperty } from '@nestjs/swagger';
import { PaymentChannel } from '@prisma/client';

export class PaymentOrderResponseDto {
  @ApiProperty({ example: 'ORD-20261024-0001' })
  orderId!: string;

  @ApiProperty({ example: 'transaction-uuid' })
  transactionId!: string;

  @ApiProperty({ example: 'ORD-20261024-0001-TX123456' })
  midtransOrderId!: string;

  @ApiProperty({ example: 105000 })
  amount!: number;

  @ApiProperty({ example: 'IDR' })
  currency!: string;

  @ApiProperty({ enum: PaymentChannel, example: PaymentChannel.SNAP_ALL })
  channel!: PaymentChannel;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    required: false,
    type: String,
    format: 'date-time',
  })
  paidAt!: Date | null;

  @ApiProperty({ example: '2026-10-24T10:00:00.000Z', format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-10-24T10:00:00.000Z', format: 'date-time' })
  updatedAt!: Date;
}

export class ListPaymentOrdersResponseDto {
  @ApiProperty({ type: [PaymentOrderResponseDto] })
  data!: PaymentOrderResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  pageSize!: number;

  @ApiProperty({ example: 1250 })
  total!: number;
}
