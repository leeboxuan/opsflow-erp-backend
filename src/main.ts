import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Fail fast if Supabase JWT secret is missing (required for HS256 token verification after login)
function validateAuthEnv(): void {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === '') {
    throw new Error(
      'SUPABASE_JWT_SECRET missing – cannot verify Supabase access token. Set it in env (Supabase Project Settings → API → JWT Secret).',
    );
  }
}

async function bootstrap() {
  validateAuthEnv();

  const app = await NestFactory.create(AppModule);
  // Enable CORS for web app(s)
  // WEB_APP_URLS supports comma-separated origins, e.g. "http://localhost:3000,https://opsflow-erp-web.onrender.com"
  const rawOrigins =
    process.env.WEB_APP_URLS || process.env.WEB_APP_URL || "http://localhost:3000";

  const allowedOrigins = rawOrigins
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

    app.enableCors({
      origin: (origin, cb) => {
        console.log("[CORS] origin:", origin);
        console.log("[CORS] allowed:", allowedOrigins);
    
        if (!origin) return cb(null, true);
    
        const normalized = origin.replace(/\/$/, "");
        const ok = allowedOrigins.includes(normalized);
    
        console.log("[CORS] normalized:", normalized, "ok:", ok);
    
        return cb(null, ok);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id"],
    });

  // ✅ Handle CORS preflight globally (fixes OPTIONS 404)
  app.use((req: any, res: any, next: any) => {
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
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
