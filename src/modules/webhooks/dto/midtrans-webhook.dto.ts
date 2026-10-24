import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VaNumberDto {
  @ApiPropertyOptional({ example: 'bca', description: 'Bank code' })
  @IsOptional()
  @IsString()
  bank?: string;

  @ApiPropertyOptional({
    example: '1234567890123456',
    description: 'Virtual account number',
  })
  @IsOptional()
  @IsString()
  va_number?: string;
}

export class MidtransWebhookDto {
  @ApiProperty({
    example:
      'payment_notif_test_M727929445_8f2d4800-6bde-4125-92ca-55f276b40c30',
    description: 'Merchant order identifier sent in transaction request',
  })
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @ApiPropertyOptional({
    example: 'M727929445',
    description: 'Midtrans merchant identifier',
  })
  @IsOptional()
  @IsString()
  merchant_id?: string;

  @ApiProperty({
    example: '513f1f01-c9da-474c-9fc9-d5c64364b709',
    description: 'Midtrans unique transaction identifier (UUID)',
  })
  @IsString()
  @IsNotEmpty()
  transaction_id!: string;

  @ApiPropertyOptional({
    example: '2023-11-15 18:45:13',
    description: 'Timestamp when transaction occurred in Midtrans',
  })
  @IsOptional()
  @IsString()
  transaction_time?: string;

  @ApiPropertyOptional({
    example: '2023-11-15 22:45:13',
    description: 'Timestamp when payment was settled',
  })
  @IsOptional()
  @IsString()
  settlement_time?: string;

  @ApiProperty({
    example: 'gopay',
    description: 'Payment method/channel used by customer',
  })
  @IsString()
  @IsNotEmpty()
  payment_type!: string;

  @ApiProperty({
    example: 'settlement',
    description:
      'Transaction status in Midtrans (settlement, capture, pending, deny, cancel, expire)',
  })
  @IsString()
  @IsNotEmpty()
  transaction_status!: string;

  @ApiPropertyOptional({
    example: 'midtrans payment notification',
    description: 'Status message description from Midtrans',
  })
  @IsOptional()
  @IsString()
  status_message?: string;

  @ApiProperty({
    example: '200',
    description: 'Midtrans response status code',
  })
  @IsString()
  @IsNotEmpty()
  status_code!: string;

  @ApiProperty({
    example: '105000.00',
    description: 'Total transaction amount as formatted string',
  })
  @IsString()
  @IsNotEmpty()
  gross_amount!: string;

  @ApiPropertyOptional({
    example: 'IDR',
    description: 'Transaction currency',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    example: 'accept',
    description: 'Fraud detection status (accept, challenge, deny)',
  })
  @IsOptional()
  @IsString()
  fraud_status?: string;

  @ApiProperty({
    example:
      '3eee83866166224898d5f566cc491d8c855dc26f0659dec7eb69cca5f314ee8860df09b0e890028ef5293df2c867e16af424ec941017a53ac9aa4f4943088caa',
    description:
      'SHA-512 signature key for validating notification authenticity',
  })
  @IsString()
  @IsNotEmpty()
  signature_key!: string;

  @ApiPropertyOptional({
    type: [VaNumberDto],
    description:
      'Array of virtual account numbers (for bank transfer payments)',
  })
  @IsOptional()
  @IsArray()
  va_numbers?: VaNumberDto[];

  @ApiPropertyOptional({
    example: '00',
    description: 'Bank or channel response code',
  })
  @IsOptional()
  @IsString()
  channel_response_code?: string;

  @ApiPropertyOptional({
    example: 'Success',
    description: 'Bank or channel response message',
  })
  @IsOptional()
  @IsString()
  channel_response_message?: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Bank approval code for card transactions',
  })
  @IsOptional()
  @IsString()
  approval_code?: string;

  @ApiPropertyOptional({ example: 'on-us', description: 'Transaction type' })
  @IsOptional()
  @IsString()
  transaction_type?: string;

  @ApiPropertyOptional({ example: 'gopay', description: 'Acquirer for QRIS' })
  @IsOptional()
  @IsString()
  acquirer?: string;

  @ApiPropertyOptional({ example: 'gopay', description: 'Issuer for QRIS' })
  @IsOptional()
  @IsString()
  issuer?: string;

  @ApiPropertyOptional({ example: '2026-10-24 21:03:58' })
  @IsOptional()
  @IsString()
  expiry_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  customer_details?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pop_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  merchant_cross_reference_id?: string;
}
