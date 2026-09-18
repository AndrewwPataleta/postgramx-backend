import 'reflect-metadata';

import 'dotenv/config';
import { loadEnvConfig } from './config/env';
import { json, urlencoded } from 'express';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ResponseSanitizerInterceptor } from './common/interceptors/response-sanitizer.interceptor';

async function bootstrap() {
  loadEnvConfig();

  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  app.useGlobalInterceptors(new ResponseSanitizerInterceptor());

  const bodyLimit = process.env.REQUEST_BODY_LIMIT || '30mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.enableCors({
    origin: true,
    credentials: true,
  });

  if (['local', 'stage'].includes(process.env.NODE_ENV || '')) {
    const config = new DocumentBuilder()
      .setTitle('PostgramX API')
      .setDescription('API documentation for PostgramX')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document);
  }

  const port = parseInt(process.env.PORT || '80', 10);
  await app.listen(port);

  const dbHost = process.env.POSTGRES_HOST || 'localhost';
  const dbPort = process.env.POSTGRES_PORT || '5432';
  const dbName = process.env.POSTGRES_DB || 'postgres';

  logger.log(`Database: ${dbHost}:${dbPort}/${dbName}`);
  logger.log(`Server is running on port ${port}`);
}

bootstrap();
