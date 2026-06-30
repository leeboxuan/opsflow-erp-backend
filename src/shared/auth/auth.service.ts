import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import * as jwt from 'jsonwebtoken';

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
  /** Global app role from public.users.role (e.g. 'USER', 'SUPERADMIN') */
  role: string;
  /** True when role === 'SUPERADMIN' (platform-level access) */
  isSuperadmin: boolean;
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
    // Get project URL or ref
    const projectUrl =
      this.configService.get<string>('SUPABASE_PROJECT_URL') ||
      this.configService.get<string>('SUPABASE_URL');
    const projectRef = this.configService.get<string>('SUPABASE_PROJECT_REF');

    if (projectRef) {
      // Use project ref to build URLs
      this.issuer = `https://${projectRef}.supabase.co/auth/v1`;
      this.jwksUrl = `${this.issuer}/.well-known/jwks.json`;
    } else if (projectUrl) {
      // Extract project ref from URL if full URL provided
      const urlMatch = projectUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
      if (urlMatch) {
        const ref = urlMatch[1];
        this.issuer = `https://${ref}.supabase.co/auth/v1`;
        this.jwksUrl = `${this.issuer}/.well-known/jwks.json`;
      } else {
        throw new Error(
          'Invalid SUPABASE_PROJECT_URL format. Expected: https://<ref>.supabase.co',
        );
      }
    } else {
      throw new Error(
        'SUPABASE_PROJECT_URL or SUPABASE_PROJECT_REF must be configured',
      );
    }

    // Create JWKS set
    this.jwks = createRemoteJWKSet(new URL(this.jwksUrl));
  }

  async verifyToken(token: string): Promise<AuthUser | null> {
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      return null;
    }

    // Temporary debug: Supabase may issue HS256 (legacy) or RS256 (JWKS); HS256 requires SUPABASE_JWT_SECRET
    console.log('JWT alg:', header.alg);

    // HS256 tokens are verified with symmetric key (verifyTokenLegacy); RS256 uses JWKS
    if (header.alg === 'HS256') {
      return this.verifyTokenLegacy(token);
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
      });

      const authUserId = payload.sub as string | undefined;
      const email = payload.email as string | undefined;

      if (!authUserId) {
        this.logger.error('JWT sub (authUserId) missing – cannot map Supabase Auth user to internal user');
        return null;
      }
      if (!email) {
        this.logger.error('JWT email missing – cannot map or create internal user');
        return null;
      }

      // Map Supabase Auth user (JWT sub, UUID) to public.users via authUserId; id remains cuid
      let user = await this.prisma.user.findFirst({
        where: { authUserId },
      });

      // Fallback for legacy rows that have no authUserId yet: match by email then backfill
      if (!user) {
        user = await this.prisma.user.findFirst({
          where: { email },
        });
      }

      if (!user) {
        // First login: auto-create internal user linked to this Supabase Auth user
        user = await this.prisma.user.create({
          data: {
            authUserId,
            email,
            name: email, // temporary default until profile is set
            role: 'USER',
          },
        });
      } else {
        // Backfill authUserId if missing (legacy row)
        const updates: { authUserId?: string; role?: string } = {};
        if (!user.authUserId) {
          updates.authUserId = authUserId;
        }
        if (!user.role) {
          updates.role = 'USER';
        }
        if (Object.keys(updates).length > 0) {
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: updates,
          });
        }
      }

      const role = user.role ?? 'USER';
      const isSuperadmin = role === 'SUPERADMIN';

      return {
        userId: user.id,
        authUserId,
        email: user.email,
        role,
        isSuperadmin,
      };
    } catch (err) {
      this.logger.warn('User mapping failed: token verification or DB lookup/create failed', (err as Error)?.message ?? err);
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

      const authUserId = decoded.sub;
      const email = decoded.email;

      if (!authUserId) {
        this.logger.error('JWT sub (authUserId) missing – cannot map Supabase Auth user to internal user');
        return null;
      }
      if (!email) {
        this.logger.error('JWT email missing – cannot map or create internal user');
        return null;
      }

      // Map by authUserId first (JWT sub); fallback to email for legacy rows
      let user = await this.prisma.user.findFirst({
        where: { authUserId },
      });

      if (!user) {
        user = await this.prisma.user.findFirst({
          where: { email },
        });
      }

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            authUserId,
            email,
            name: email, // temporary default until profile is set
            role: 'USER',
          },
        });
      } else {
        const updates: { authUserId?: string; role?: string } = {};
        if (!user.authUserId) {
          updates.authUserId = authUserId;
        }
        if (!user.role) {
          updates.role = 'USER';
        }
        if (Object.keys(updates).length > 0) {
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: updates,
          });
        }
      }

      const role = user.role ?? 'USER';
      const isSuperadmin = role === 'SUPERADMIN';

      return {
        userId: user.id,
        authUserId,
        email: user.email,
        role,
        isSuperadmin,
      };
    } catch (error) {
      this.logger.warn('User mapping failed (legacy HS256): verification or DB failed', (error as Error)?.message ?? error);
      return null;
    }
  }
}
