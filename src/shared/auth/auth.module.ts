import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { AuthGuard } from './guards/auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { RoleGuard } from './guards/role.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { ModuleEntitlementGuard } from './guards/module-entitlement.guard';
import { DestructiveActionGuard } from './guards/destructive-action.guard';
import { StaffWebGuard } from './guards/staff-web.guard';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Auth module (Supabase auth).
 * Required env vars:
 *   - SUPABASE_URL or SUPABASE_PROJECT_URL: Supabase project URL (e.g. https://<ref>.supabase.co)
 *   - SUPABASE_ANON_KEY: Supabase anon/public key (for login and JWKS)
 *   - SUPABASE_JWT_SECRET: Supabase JWT Secret (required for HS256 access token verification after login)
 *
 * Platform Super Admin:
 *   - SUPERADMIN is a global User.role bridge only — never a tenant Role.
 *   - PlatformAdminGuard gates /platform/* routes. Never trust client isPlatformAdmin flags.
 *   - ModuleEntitlementGuard enforces TenantModule entitlements on opted-in ops controllers.
 *   - DestructiveActionGuard requires reason for Platform Admin on marked routes.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SupabaseService,
    AuthGuard,
    TenantGuard,
    RoleGuard,
    PlatformAdminGuard,
    ModuleEntitlementGuard,
    DestructiveActionGuard,
    StaffWebGuard,
  ],
  exports: [
    AuthService,
    SupabaseService,
    AuthGuard,
    TenantGuard,
    RoleGuard,
    PlatformAdminGuard,
    ModuleEntitlementGuard,
    DestructiveActionGuard,
    StaffWebGuard,
  ],
})
export class AuthModule {}
