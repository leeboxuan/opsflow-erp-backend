import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Set global prefix for all routes
  app.setGlobalPrefix('api');
  
  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  
  // Enable CORS for web app(s)
// WEB_APP_URLS supports comma-separated origins, e.g. "http://localhost:3000,https://opsflow-erp-web.onrender.com"
const rawOrigins = process.env.WEB_APP_URLS || process.env.WEB_APP_URL || 'http://localhost:3000';
const allowedOrigins = rawOrigins
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.enableCors({
  origin: allowedOrigins,
  credentials: true,
});

  // Swagger documentation setup
  const config = new DocumentBuilder()
    .setTitle('OpsFlow ERP API')
    .setDescription('API documentation for OpsFlow ERP Transport Management System')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();
  // Use 'as any' to avoid type incompatibility issues across nested Node module resolutions
  const document = SwaggerModule.createDocument(app as any, config);
  SwaggerModule.setup('api/docs', app as any, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`API server running on http://localhost:${port}`);
  console.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}
bootstrap();
