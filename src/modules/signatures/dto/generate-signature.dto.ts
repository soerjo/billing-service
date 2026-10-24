import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateSignatureDto {
  @ApiProperty({
    example: 'POST',
    description: 'HTTP method of the target request (GET, POST, etc.)',
  })
  @IsString()
  @IsNotEmpty()
  method!: string;

  @ApiProperty({
    example: '/api/v1/payments/snap',
    description: 'Path of the target endpoint',
  })
  @IsString()
  @IsNotEmpty()
  path!: string;

  @ApiPropertyOptional({
    example: '2026-10-24T14:00:00.000Z',
    description:
      'Timestamp (ISO-8601 or epoch ms). If omitted, current timestamp is generated automatically.',
  })
  @IsOptional()
  timestamp?: string | number;

  @ApiPropertyOptional({
    example: { orderId: 'ORD-20261024-0001', amount: 150000 },
    description: 'Request body JSON payload (for POST/PUT methods)',
  })
  @IsOptional()
  body?: unknown;
}
