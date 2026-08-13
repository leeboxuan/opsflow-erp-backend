import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import * as jwt from 'jsonwebtoken';
import { resolveSupabaseJwtIssuer } from './supabase-jwt-issuer';
import {
  jwtEmailFromPayload,
  mapSupabaseSubjectToInternalUser,
} from './map-internal-user';

export interface JwtPayload {
  sub: string;
  email: string;
  alg?: string;
  iss?: string;
  aud?: string | string[];
  [key: string]: any;
}

export interface AuthUser {
  /** Internal app user id (public.users.id, cuid) */
  userId: string;
  /** Supabase auth user id (auth.users.id, UUID) */
  authUserId: string;
  /** User email from JWT / public.users.email */
  email: string;
  /**
   * Global app role from public.users.role (e.g. 'USER', 'SUPERADMIN').
   * SUPERADMIN is NOT a tenant Role — platform authority is PlatformAdmin.
   */
  role: string;
  /**
   * True when PlatformAdmin ACTIVE exists, or legacy role === SUPERADMIN.
   * Never accept this flag from the client — AuthService sets it from DB only.
   */
  isSuperadmin: boolean;
  /** PlatformAdmin row id when ACTIVE; null otherwise. */
  platformAdminId?: string | null;
  platformAdminStatus?: string | null;
  isPlatformAdmin?: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private jwksUrl: string;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const resolved = resolveSupabaseJwtIssuer({
      SUPABASE_PROJECT_URL: this.configService.get<string>('SUPABASE_PROJECT_URL'),
      SUPABASE_URL: this.configService.get<string>('SUPABASE_URL'),
      SUPABASE_PROJECT_REF: this.configService.get<string>('SUPABASE_PROJECT_REF'),
    });
    this.issuer = resolved.issuer;
    this.jwksUrl = resolved.jwksUrl;
    this.jwks = createRemoteJWKSet(new URL(this.jwksUrl));
  }

  async verifyToken(token: string): Promise<AuthUser | null> {
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      return null;
    }

    // HS256 tokens are verified with symmetric key (verifyTokenLegacy); ES256/RS256 use JWKS
    if (header.alg === 'HS256') {
      return this.verifyTokenLegacy(token);
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
      });

      return this.mapVerifiedSubject({
        authUserId: payload.sub as string | undefined,
        email: jwtEmailFromPayload(payload),
      });
    } catch (err) {
      this.logger.warn('User mapping failed: token verification or DB lookup/create failed', (err as Error)?.message ?? err);
      return null;
    }
  }

  /**
   * Load PlatformAdmin row if the table exists. Returns null when missing / pre-migration.
   */
  private async loadPlatformAdmin(
    userId: string,
  ): Promise<{ id: string; status: string } | null> {
    try {
      const row = await this.prisma.platformAdmin.findUnique({
        where: { userId },
        select: { id: true, status: true },
      });
      return row;
    } catch {
      return null;
    }
  }

  /**
   * Verifies HS256 JWTs using SUPABASE_JWT_SECRET (symmetric key).
   * Returns null when SUPABASE_JWT_SECRET is missing or verification fails.
   */
  private async verifyTokenLegacy(token: string): Promise<AuthUser | null> {
    const jwtSecret = this.configService.get<string>('SUPABASE_JWT_SECRET');

    if (!jwtSecret) {
      return null; // Required for HS256; caller should surface "SUPABASE_JWT_SECRET missing" when applicable
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
      return this.mapVerifiedSubject({
        authUserId: decoded.sub,
        email: jwtEmailFromPayload(decoded),
      });
    } catch (error) {
      this.logger.warn('User mapping failed (legacy HS256): verification or DB failed', (error as Error)?.message ?? error);
      return null;
    }
  }

  private async mapVerifiedSubject(params: {
    authUserId?: string;
    email?: string | null;
  }): Promise<AuthUser | null> {
    const authUserId = params.authUserId?.trim();
    if (!authUserId) {
      this.logger.error('JWT sub (authUserId) missing – cannot map Supabase Auth user to internal user');
      return null;
    }

    const user = await mapSupabaseSubjectToInternalUser(this.prisma as any, {
      authUserId,
      email: params.email,
    });
    if (!user) {
      return null;
    }

    const role = user.role ?? 'USER';
    const platformAdmin = await this.loadPlatformAdmin(user.id);
    const isPlatformAdmin = platformAdmin?.status === 'ACTIVE';
    const isSuperadmin = isPlatformAdmin || role === 'SUPERADMIN';

    return {
      userId: user.id,
      authUserId,
      email: user.email,
      role,
      isSuperadmin,
      platformAdminId: isPlatformAdmin ? platformAdmin!.id : null,
      platformAdminStatus: platformAdmin?.status ?? null,
      isPlatformAdmin,
    };
  }
}
