import { ApiProperty } from '@nestjs/swagger';

export class GenerateSignatureResponseDto {
  @ApiProperty({
    example: 'c8afa9531677496ab9ab7e971cda7249a8f5c34e595e3d0aacb865f4a13cba7b',
    description: 'Generated HMAC-SHA256 signature',
  })
  signature!: string;

  @ApiProperty({
    example: '2026-10-24T14:00:00.000Z',
    description: 'Timestamp used in signature calculation',
  })
  timestamp!: string;

  @ApiProperty({
    example: 'POST:/api/v1/payments/snap:2026-10-24T14:00:00.000Z:a8f5c3...',
    description: 'Formatted payload that was hashed with HMAC-SHA256',
  })
  payloadToSign!: string;

  @ApiProperty({
    example: {
      'X-Api-Key': 'sb-api-key-test',
      'X-Signature':
        'c8afa9531677496ab9ab7e971cda7249a8f5c34e595e3d0aacb865f4a13cba7b',
      'X-Timestamp': '2026-10-24T14:00:00.000Z',
    },
    description:
      'Ready-to-use HTTP headers for calling billing-service endpoints',
  })
  headers!: Record<string, string>;
}
