import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPort,
  IsString,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsPort()
  @IsOptional()
  PORT: string = '3504';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;
  // Service-to-Service API Key Authentication
  @IsString()
  @IsOptional()
  API_KEY?: string;

  @IsString()
  @IsOptional()
  MIDTRANS_SERVER_KEY?: string;

  @IsString()
  @IsOptional()
  MIDTRANS_CLIENT_KEY?: string;

  @IsBoolean()
  @IsOptional()
  MIDTRANS_IS_PRODUCTION: boolean = false;

  // Kafka Event Broker
  @IsBoolean()
  @IsOptional()
  KAFKA_ENABLED: boolean = process.env.NODE_ENV === Environment.Production;

  @IsString()
  @IsOptional()
  KAFKA_BROKERS: string = 'kafka:29092';

  @IsString()
  @IsOptional()
  KAFKA_CLIENT_ID: string = 'billing-service';

  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  @IsBoolean()
  @IsOptional()
  REDIS_ENABLED: boolean = process.env.NODE_ENV !== Environment.Test;

  @IsString()
  @IsOptional()
  REDIS_URL: string = 'redis://localhost:6379';

  @IsOptional()
  REDIS_IDEMPOTENCY_TTL_SECONDS: number = 60;
}

export function validate(config: Record<string, unknown>) {
  const normalizedConfig = { ...config };
  for (const key of [
    'MIDTRANS_IS_PRODUCTION',
    'KAFKA_ENABLED',
    'REDIS_ENABLED',
  ] as const) {
    const value = normalizedConfig[key];
    if (value === 'true') normalizedConfig[key] = true;
    if (value === 'false') normalizedConfig[key] = false;
  }

  const validated = plainToInstance(EnvironmentVariables, normalizedConfig, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validated;
}
