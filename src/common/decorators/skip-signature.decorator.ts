import { SetMetadata } from '@nestjs/common';

export const SKIP_SIGNATURE_KEY = 'skipSignature';
export const SkipSignature = () => SetMetadata(SKIP_SIGNATURE_KEY, true);
