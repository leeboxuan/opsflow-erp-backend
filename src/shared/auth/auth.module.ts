import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { AuthGuard } from './guards/auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { RoleGuard } from './guards/role.guard';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Auth module (Supabase auth).
 * Required env vars:
 *   - SUPABASE_URL or SUPABASE_PROJECT_URL: Supabase project URL (e.g. https://<ref>.supabase.co)
 *   - SUPABASE_ANON_KEY: Supabase anon/public key (for login and JWKS)
 *   - SUPABASE_JWT_SECRET: Supabase JWT Secret (required for HS256 access token verification after login)
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, SupabaseService, AuthGuard, TenantGuard, RoleGuard],
  exports: [AuthService, SupabaseService, AuthGuard, TenantGuard, RoleGuard],
})
export class AuthModule {}
