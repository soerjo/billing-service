import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Min } from 'class-validator';

export class RequestPayoutDto {
  @ApiProperty({
    example: 'org-123',
    description: 'Organization requesting the payout',
  })
  @IsString()
  organizationId!: string;

  @ApiProperty({ example: 150000, description: 'Amount in IDR', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'bca', description: 'Destination bank code' })
  @IsString()
  bankCode!: string;

  @ApiProperty({
    example: '1234567890',
    description: 'Destination account number',
  })
  @IsString()
  bankAccountNumber!: string;

  @ApiProperty({
    example: 'PT Contoh',
    description: 'Destination account holder name',
  })
  @IsString()
  bankAccountName!: string;
}
