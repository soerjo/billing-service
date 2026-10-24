import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildPayloadToSign,
  generateHmacSignature,
} from '../../common/utils/signature.util.js';
import { GenerateSignatureDto } from './dto/generate-signature.dto.js';
import { GenerateSignatureResponseDto } from './dto/generate-signature-response.dto.js';

@Injectable()
export class SignaturesService {
  constructor(private readonly configService: ConfigService) {}

  generateSignature(
    dto: GenerateSignatureDto,
    apiKeyOverride?: string,
  ): GenerateSignatureResponseDto {
    const apiKey = apiKeyOverride || this.configService.get<string>('API_KEY');
    if (!apiKey) {
      throw new UnauthorizedException('API key is not configured');
    }

    const timestamp = dto.timestamp
      ? String(dto.timestamp)
      : new Date().toISOString();
    const payloadToSign = buildPayloadToSign({
      method: dto.method,
      path: dto.path,
      timestamp,
      body: dto.body,
    });

    const signature = generateHmacSignature(payloadToSign, apiKey);

    return {
      signature,
      timestamp,
      payloadToSign,
      headers: {
        'X-Api-Key': apiKey,
        'X-Signature': signature,
        'X-Timestamp': timestamp,
      },
    };
  }
}
