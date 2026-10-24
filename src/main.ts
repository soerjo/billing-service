import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import {
  WINSTON_MODULE_NEST_PROVIDER,
  WINSTON_MODULE_PROVIDER,
} from 'nest-winston';
import type { Request, Response } from 'express';
import type { Logger } from 'winston';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor.js';
import { createRequestLoggingMiddleware } from './common/middleware/request-logging.middleware.js';
import { parseCorsOrigins } from './common/utils/cors-origins.util.js';
import { MetricsService } from './modules/metrics/metrics.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.use(helmet());
  app.setGlobalPrefix('api');

  const winstonLogger = app.get<Logger>(WINSTON_MODULE_PROVIDER);
  const metricsService = app.get(MetricsService);
  const configService = app.get(ConfigService);

  app.use(createRequestLoggingMiddleware(winstonLogger, metricsService));

  app.use('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', metricsService.contentType);
    res.end(await metricsService.getMetrics());
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseTransformInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Payment Integration API')
    .setDescription(
      'Payment Gateway Integration & Midtrans Adapter API documentation',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const corsOrigins = parseCorsOrigins(
    configService.get<string>('CORS_ORIGINS'),
  );
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins });
  } else {
    app.enableCors();
  }

  await app.listen(process.env.PORT ?? 3000);
  // const appUrl = await app.getUrl();
  winstonLogger.info(
    `Application URL: http://localhost:${process.env.PORT ?? 3000}/api`,
  );
  winstonLogger.info(
    `Swagger URL: http://localhost:${process.env.PORT ?? 3000}/docs`,
  );
}
bootstrap().catch((err) => {
  console.error('Failed to bootstrap application:', err);
  process.exit(1);
});
