import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { AuthGuard } from './guards/auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { RoleGuard } from './guards/role.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, SupabaseService, AuthGuard, TenantGuard, RoleGuard],
  exports: [AuthService, SupabaseService, AuthGuard, TenantGuard, RoleGuard],
})
export class AuthModule {}
