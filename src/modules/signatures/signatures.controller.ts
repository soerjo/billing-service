import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SignaturesService } from './signatures.service.js';
import { GenerateSignatureDto } from './dto/generate-signature.dto.js';
import { GenerateSignatureResponseDto } from './dto/generate-signature-response.dto.js';
import { SkipSignature } from '../../common/decorators/skip-signature.decorator.js';

@ApiTags('Signatures')
@ApiSecurity('api-key')
@Controller('v1/signatures')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @SkipSignature()
  @ApiOperation({
    summary:
      'Generate HMAC-SHA256 request signature and headers for service-to-service calls',
  })
  @ApiOkResponse({ type: GenerateSignatureResponseDto })
  generateSignature(
    @Body() dto: GenerateSignatureDto,
    @Headers('x-api-key') apiKeyHeader?: string,
  ): GenerateSignatureResponseDto {
    return this.signaturesService.generateSignature(dto, apiKeyHeader);
  }
}
