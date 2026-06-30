import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/common/all-exceptions.filter';
import { JSON_BODY_LIMIT } from './shared/common/http-body.config';
import { PrismaExceptionFilter } from './shared/common/prisma-exception.filter';

// Fail fast if Supabase JWT secret is missing (required for HS256 token verification after login)
function validateAuthEnv(): void {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === '') {
    throw new Error(
      'SUPABASE_JWT_SECRET missing – cannot verify Supabase access token. Set it in env (Supabase Project Settings → API → JWT Secret).',
    );
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const enableSwagger =
  process.env.ENABLE_SWAGGER === 'true' || !isProduction;

async function bootstrap() {
  validateAuthEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  app.useBodyParser("urlencoded", { extended: true, limit: JSON_BODY_LIMIT });
  app.useGlobalFilters(new PrismaExceptionFilter(), new AllExceptionsFilter());
  const rawOrigins =
    process.env.WEB_APP_URLS || process.env.WEB_APP_URL || "http://localhost:3000";

  const allowedOrigins = rawOrigins
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

    app.enableCors({
      origin: (origin, cb) => {
        if (!isProduction) {
          console.log("[CORS] origin:", origin);
          console.log("[CORS] allowed:", allowedOrigins);
        }

        if (!origin) return cb(null, true);

        const normalized = origin.replace(/\/$/, "");
        const ok = allowedOrigins.includes(normalized);

        if (!isProduction) {
          console.log("[CORS] normalized:", normalized, "ok:", ok);
        }

        return cb(null, ok);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id"],
    });

  app.use((req: any, res: any, next: any) => {
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (enableSwagger) {
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
    const document = SwaggerModule.createDocument(app as any, config);
    SwaggerModule.setup('api/docs', app as any, document);
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`API server running on http://localhost:${port}`);
  if (enableSwagger) {
    console.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
  }
}
bootstrap();
