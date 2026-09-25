import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';

// Global BigInt Serialization Fix for Express/Prisma
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Pastikan folder uploads/media tersedia
  const mediaUploadDir = join(process.cwd(), 'uploads', 'media');
  if (!existsSync(mediaUploadDir)) {
    mkdirSync(mediaUploadDir, { recursive: true });
    logger.log(`Membuat direktori penyimpanan media lokal: ${mediaUploadDir}`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Increase payload limit to 50MB for DOCX export with Base64 embedded images & infographics
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Serve static assets for uploaded media with explicit CORS headers
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  // Enable CORS for PWA Frontend
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global DTO Validation Pipe with strict transformation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global HTTP Exception Filter
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`BRIDA SMART Analysis (Backend Engine) is running on port ${port}`);
}
bootstrap();
