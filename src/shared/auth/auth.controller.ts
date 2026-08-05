import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MembershipStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { AuthGuard } from './guards/auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { getUserAvatarSignedUrl } from '../users/user-avatar';
import { SkipTenantGuard } from './guards/skip-tenant-guard.decorator';
import {
  normalizeUsername,
  publicEmailOrNull,
} from './auth-internal-email';
import { getSafeTenantTimezone } from '../common/tenant-timezone';

const USERNAME_LOGIN_ERROR = 'Invalid username or password';
const EMAIL_LOGIN_ERROR = 'Invalid email or password';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) { }

  @Post('login')
  @ApiOperation({ summary: 'Login with email or username and password' })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const supabaseUrl =
      this.configService.get<string>('SUPABASE_PROJECT_URL') ||
      this.configService.get<string>('SUPABASE_URL') ||
      '';
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new UnauthorizedException('Supabase configuration is missing. SUPABASE_ANON_KEY is required for login.');
    }

    const usernameRaw = dto.username?.trim();
    const emailRaw = dto.email?.trim();
    const isUsernameLogin = Boolean(usernameRaw) && !emailRaw;
    const loginError = isUsernameLogin ? USERNAME_LOGIN_ERROR : EMAIL_LOGIN_ERROR;

    if (!usernameRaw && !emailRaw) {
      throw new UnauthorizedException(loginError);
    }

    let authEmail = emailRaw?.toLowerCase() ?? '';
    let resolvedUserId: string | null = null;

    if (isUsernameLogin) {
      const resolved = await this.resolveUsernameLogin(
        usernameRaw!,
        dto.tenantSlug,
      );
      if (!resolved) {
        throw new UnauthorizedException(USERNAME_LOGIN_ERROR);
      }
      authEmail = resolved.authEmail;
      resolvedUserId = resolved.userId;
    }

    const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: dto.password,
    });

    if (error || !data.session) {
      throw new UnauthorizedException(loginError);
    }

    const accessToken = data.session.access_token;
    const refreshToken = data.session.refresh_token ?? '';
    const expiresAt = data.session.expires_at ?? 0;

    const authUser = await this.authService.verifyToken(accessToken);

    if (!authUser) {
      const jwtSecret = this.configService.get<string>('SUPABASE_JWT_SECRET');
      if (!jwtSecret) {
        throw new UnauthorizedException(
          'SUPABASE_JWT_SECRET missing – cannot verify Supabase access token',
        );
      }
      throw new UnauthorizedException(
        'User mapping failed: could not find or create internal user for this Supabase Auth user',
      );
    }

    if (resolvedUserId && authUser.userId !== resolvedUserId) {
      throw new UnauthorizedException(loginError);
    }

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        userId: authUser.userId,
        status: MembershipStatus.Active,
      },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            status: true,
            timezone: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out suspended/archived tenants for ordinary session selection.
    // Platform admins still receive memberships for suspended tenants (management).
    const platformAdminPayload = await this.resolvePlatformAdminPayload(
      authUser.userId,
    );
    const isPlatformAdmin =
      platformAdminPayload?.status === 'ACTIVE' ||
      authUser.isSuperadmin === true ||
      authUser.role === 'SUPERADMIN';

    const visibleMemberships = isPlatformAdmin
      ? memberships
      : memberships.filter(
          (m) =>
            !m.tenant?.status ||
            m.tenant.status === 'ACTIVE' ||
            m.tenant.status === 'SETUP',
        );

    if (isUsernameLogin && visibleMemberships.length === 0) {
      throw new UnauthorizedException(USERNAME_LOGIN_ERROR);
    }

    // Platform-only (zero memberships): allowed for web; rejected for mobile clients.
    const clientApp = (dto.clientApp ?? '').trim().toLowerCase();
    if (
      isPlatformAdmin &&
      visibleMemberships.length === 0 &&
      (clientApp === 'mobile' ||
        clientApp === 'driver_mobile' ||
        clientApp === 'warehouse_mobile')
    ) {
      throw new UnauthorizedException(
        'Platform admin accounts are not available on mobile apps',
      );
    }

    const activeMembership = visibleMemberships[0];

    const dbUser = await this.prisma.user.findUnique({
      where: { id: authUser.userId },
      select: { email: true, username: true },
    });

    const user = {
      id: authUser.userId,
      email: publicEmailOrNull(dbUser?.email ?? authUser.email),
      username: dbUser?.username ?? null,
      role: activeMembership?.role ?? null,
      tenantId: activeMembership?.tenantId ?? undefined,
    };

    return {
      accessToken,
      refreshToken,
      expiresAt,
      user,
      activeTenantId: activeMembership?.tenantId ?? null,
      activeTenantTimezone: activeMembership
        ? getSafeTenantTimezone(activeMembership.tenant.timezone)
        : null,
      tenantMemberships: visibleMemberships.map((membership) => ({
        tenantId: membership.tenantId,
        role: membership.role,
        status: membership.status,
        tenant: {
          id: membership.tenant.id,
          name: membership.tenant.name,
        },
      })),
      platformAdmin: platformAdminPayload,
    };
  }

  private async resolvePlatformAdminPayload(
    userId: string,
  ): Promise<{ id: string; status: string } | null> {
    try {
      const row = await this.prisma.platformAdmin.findUnique({
        where: { userId },
        select: { id: true, status: true },
      });
      if (!row || row.status !== 'ACTIVE') return null;
      return { id: row.id, status: row.status };
    } catch {
      return null;
    }
  }

  /**
   * Resolve username (+ optional tenant slug) to the internal Supabase auth email.
   * Returns null for unknown / ambiguous / inactive — callers must use a generic error.
   */
  private async resolveUsernameLogin(
    usernameRaw: string,
    tenantSlug?: string,
  ): Promise<{ authEmail: string; userId: string } | null> {
    const username = normalizeUsername(usernameRaw);
    if (!username) return null;

    const slug = tenantSlug?.trim().toLowerCase() || null;

    const candidates = await this.prisma.user.findMany({
      where: {
        username,
        memberships: {
          some: {
            ...(slug
              ? { tenant: { slug } }
              : {}),
          },
        },
      },
      select: {
        id: true,
        email: true,
        memberships: {
          where: slug
            ? { tenant: { slug } }
            : undefined,
          select: {
            status: true,
            tenant: { select: { slug: true } },
          },
        },
      },
      take: 5,
    });

    if (candidates.length === 0) return null;
    if (!slug && candidates.length > 1) return null;

    const user = candidates[0];
    const membership = user.memberships[0];
    if (!membership || membership.status !== MembershipStatus.Active) {
      return null;
    }

    return { authEmail: user.email, userId: user.id };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh session using refresh token' })
  async refresh(@Body() dto: RefreshTokenDto): Promise<RefreshResponseDto> {
    const supabaseUrl =
      this.configService.get<string>('SUPABASE_PROJECT_URL') ||
      this.configService.get<string>('SUPABASE_URL') ||
      '';
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new UnauthorizedException('Supabase configuration is missing');
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: dto.refreshToken,
    });

    if (error) {
      throw new UnauthorizedException(
        error.message || 'Invalid or expired refresh token',
      );
    }

    if (!data.session) {
      throw new UnauthorizedException('Session refresh failed');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token ?? '',
      expiresAt: data.session.expires_at ?? 0,
    };
  }

  @Get('me')
  @UseGuards(AuthGuard, TenantGuard)
  @SkipTenantGuard()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user and tenant information' })
  async getMe(@Request() req: any) {
    const authUserId: string | undefined = req.user.sub ?? req.user.authUserId;

    if (!authUserId) {
      throw new UnauthorizedException('Missing auth user id');
    }

    // Look up app user by authUserId (Supabase sub), backfilling defaults if needed
    let user = await this.prisma.user.findFirst({
      where: { authUserId } as any,
    });

    if (!user) {
      // As a fallback, try by email from request
      const email = req.user.email;
      if (!email) {
        throw new UnauthorizedException('User not found');
      }
      user = await this.prisma.user.findFirst({
        where: { email },
      });
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const updates: any = {};
    if (!(user as any).authUserId) {
      updates.authUserId = authUserId;
    }
    if (!(user as any).role) {
      updates.role = 'USER';
    }
    if (Object.keys(updates).length > 0) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: updates as any,
      });
    }

    const effectiveRole = (user as any).role || 'USER';

    // Get all memberships for the user
    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        userId: user.id,
      },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            status: true,
            timezone: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    const tenantMemberships = memberships.map((membership) => ({
      tenantId: membership.tenantId,
      role: membership.role,
      status: membership.status,
      tenant: {
        id: membership.tenant.id,
        name: membership.tenant.name,
        status: (membership.tenant as any).status ?? undefined,
      },
    }));

    const avatarUrl = await getUserAvatarSignedUrl({
      supabaseService: this.supabaseService,
      avatarKey: (user as any).avatarKey ?? null,
    });

    const platformAdmin = await this.resolvePlatformAdminPayload(user.id);
    const activeTenantTimezone = await this.resolveActiveTenantTimezone({
      requestedTenantId: req.headers?.['x-tenant-id'],
      memberships,
      platformAdmin,
      requestUser: req.user,
    });

    return {
      id: user.id,
      email: publicEmailOrNull(user.email),
      username: (user as any).username ?? null,
      name: (user as any).name ?? null,
      displayName:
        (user as any).displayName ??
        (user as any).name ??
        (user as any).username ??
        publicEmailOrNull(user.email) ??
        null,
      role: effectiveRole,                // global app role, never null
      authUserId: (user as any).authUserId, // Supabase auth user id
      tenantId: undefined,
      avatarUrl,
      avatarKey: (user as any).avatarKey ?? null,
      avatarUpdatedAt: (user as any).avatarUpdatedAt ?? null,
      tenantMemberships,
      platformAdmin,
      activeTenantTimezone,
    };
  }

  private async resolveActiveTenantTimezone(params: {
    requestedTenantId: unknown;
    memberships: Array<{
      tenantId: string;
      status: MembershipStatus;
      tenant: { status?: string | null; timezone?: string | null };
    }>;
    platformAdmin: { id: string; status: string } | null;
    requestUser: {
      isSuperadmin?: boolean;
      isPlatformAdmin?: boolean;
      role?: string;
    };
  }): Promise<string | null> {
    const tenantId =
      typeof params.requestedTenantId === 'string'
        ? params.requestedTenantId.trim()
        : '';
    if (!tenantId) return null;

    const membership = params.memberships.find(
      (item) =>
        item.tenantId === tenantId &&
        item.status === MembershipStatus.Active &&
        item.tenant.status !== 'SUSPENDED' &&
        item.tenant.status !== 'ARCHIVED',
    );
    if (membership) {
      return getSafeTenantTimezone(membership.tenant.timezone);
    }

    const isPlatformAdmin =
      params.platformAdmin?.status === 'ACTIVE' ||
      params.requestUser.isPlatformAdmin === true ||
      params.requestUser.isSuperadmin === true ||
      params.requestUser.role === 'SUPERADMIN';
    if (!isPlatformAdmin) return null;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true, status: true },
    });
    return tenant && tenant.status !== 'ARCHIVED'
      ? getSafeTenantTimezone(tenant.timezone)
      : null;
  }
}
