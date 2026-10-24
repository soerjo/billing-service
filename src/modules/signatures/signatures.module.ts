import { Module } from '@nestjs/common';
import { SignaturesController } from './signatures.controller.js';
import { SignaturesService } from './signatures.service.js';

@Module({
  controllers: [SignaturesController],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
