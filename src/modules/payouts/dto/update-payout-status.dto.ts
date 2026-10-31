import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdatePayoutStatusDto {
  @ApiProperty({ enum: PayoutStatus })
  @IsEnum(PayoutStatus)
  status!: PayoutStatus;

  @ApiPropertyOptional({ example: 'Bank account name mismatch' })
  @IsOptional()
  @IsString()
  reason?: string;
}
