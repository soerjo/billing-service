import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/billing_db';
process.env.MIDTRANS_SERVER_KEY =
  process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-testkey12345';
process.env.MIDTRANS_CLIENT_KEY =
  process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-testkey12345';

async function generate() {
  const { AppModule } = await import('../src/app.module.js');

  const app = await NestFactory.create(AppModule, {
    logger: false,
  });

  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Payment Integration API')
    .setDescription('Payment Gateway Integration & Midtrans Adapter API documentation')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outputPath = resolve(process.cwd(), 'contracts/openapi.json');
  mkdirSync(dirname(outputPath), { recursive: true });

  const sortedKeys = (obj: any): any => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortedKeys(obj[key]);
    }
    return sorted;
  };

  const formattedJson = JSON.stringify(sortedKeys(document), null, 2) + '\n';
  writeFileSync(outputPath, formattedJson, 'utf-8');

  const pathCount = Object.keys(document.paths || {}).length;
  console.log(`[docs:openapi] generated ${outputPath} — ${pathCount} paths`);

  await app.close();
}

generate().catch((err) => {
  console.error('Failed to generate OpenAPI contract:', err);
  process.exit(1);
});
