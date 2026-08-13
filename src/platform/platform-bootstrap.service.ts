import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlatformAdminStatus, Prisma, UserRole } from "@prisma/client";
import { createHash, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { PrismaService } from "../shared/prisma/prisma.service";
import { SupabaseService } from "../shared/auth/supabase.service";
import { PlatformAuditService } from "./platform-audit.service";

const BOOTSTRAP_UNAVAILABLE = "Platform bootstrap is no longer available";
const BOOTSTRAP_NOT_CONFIGURED = "Platform bootstrap is not available";

export type PlatformBootstrapActor = {
  userId: string;
  email: string;
};

@Injectable()
export class PlatformBootstrapService {
  private readonly logger = new Logger(PlatformBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async getStatus(): Promise<{ available: boolean }> {
    if (!this.isBootstrapConfigured()) return { available: false };
    const count = await this.prisma.platformAdmin.count();
    return { available: count === 0 };
  }

  async setup(dto: {
    email: string;
    password: string;
    name: string;
    bootstrapToken: string;
  }): Promise<{ ok: boolean; platformAdmin: { id: string; status: string } }> {
    const email = this.normalizeEmail(dto.email);
    this.assertOwnerEmail(email);
    this.assertBootstrapToken(dto.bootstrapToken);
    const status = await this.getStatus();
    if (!status.available) {
      throw new GoneException(BOOTSTRAP_UNAVAILABLE);
    }

    const name = dto.name.trim();
    let newlyCreatedAuthUserId: string | null = null;

    try {
      const authUserId = await this.resolveOrCreateAuthUser({
        email,
        password: dto.password,
        name,
        onCreated: (id) => {
          newlyCreatedAuthUserId = id;
        },
      });

      const result = await this.promoteInTransaction({
        email,
        name,
        authUserId,
        method: "setup",
        existingMembershipCount: 0,
      });
      return result;
    } catch (err) {
      if (newlyCreatedAuthUserId) {
        await this.compensateDeleteAuthUser(newlyCreatedAuthUserId);
      }
      throw this.mapUniqueConflict(err);
    }
  }

  async claim(actor: PlatformBootstrapActor): Promise<{
    ok: boolean;
    platformAdmin: { id: string; status: string };
    dualIdentity: boolean;
    existingMembershipCount: number;
  }> {
    if (!this.isBootstrapConfigured()) {
      throw new ForbiddenException(BOOTSTRAP_NOT_CONFIGURED);
    }
    const jwtEmail = this.normalizeEmail(actor.email);
    this.assertOwnerEmail(jwtEmail);

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
    });
    if (!user) {
      throw new ForbiddenException(BOOTSTRAP_NOT_CONFIGURED);
    }
    this.assertOwnerEmail(this.normalizeEmail(user.email));

    const existingMembershipCount = await this.prisma.tenantMembership.count({
      where: { userId: user.id },
    });

    try {
      const result = await this.promoteInTransaction({
        email: this.normalizeEmail(user.email),
        name: user.name?.trim() || jwtEmail,
        authUserId: user.authUserId,
        existingUserId: user.id,
        method: "claim",
        existingMembershipCount,
      });
      return {
        ...result,
        dualIdentity: existingMembershipCount > 0,
        existingMembershipCount,
      };
    } catch (err) {
      throw this.mapUniqueConflict(err);
    }
  }

  private async promoteInTransaction(params: {
    email: string;
    name: string;
    authUserId: string | null;
    existingUserId?: string;
    method: "setup" | "claim";
    existingMembershipCount: number;
  }): Promise<{ ok: boolean; platformAdmin: { id: string; status: string } }> {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.platformAdmin.count();
      if (count > 0) {
        throw new GoneException(BOOTSTRAP_UNAVAILABLE);
      }

      let user =
        params.existingUserId
          ? await tx.user.findUnique({ where: { id: params.existingUserId } })
          : await tx.user.findUnique({ where: { email: params.email } });

      if (!user) {
        user = await tx.user.create({
          data: {
            email: params.email,
            name: params.name,
            authUserId: params.authUserId,
            role: UserRole.USER,
          },
        });
      } else {
        const updates: {
          authUserId?: string;
          name?: string;
        } = {};
        if (params.authUserId && !user.authUserId) {
          updates.authUserId = params.authUserId;
        }
        if (params.name && !user.name) {
          updates.name = params.name;
        }
        if (Object.keys(updates).length > 0) {
          user = await tx.user.update({
            where: { id: user.id },
            data: updates,
          });
        }
      }

      const existingPa = await tx.platformAdmin.findUnique({
        where: { userId: user.id },
      });
      if (existingPa) {
        throw new ConflictException("User is already a platform admin");
      }

      const pa = await tx.platformAdmin.create({
        data: {
          userId: user.id,
          status: PlatformAdminStatus.ACTIVE,
          createdByUserId: user.id,
          notes: params.method === "claim" ? "claimed" : "bootstrapped",
        },
      });

      if (user.role !== UserRole.SUPERADMIN) {
        await tx.user.update({
          where: { id: user.id },
          data: { role: UserRole.SUPERADMIN },
        });
      }

      await this.audit.appendInTx(tx, {
        actorPlatformAdminId: pa.id,
        actorUserId: user.id,
        action:
          params.method === "claim"
            ? "PLATFORM_ADMIN_CLAIM"
            : "PLATFORM_ADMIN_BOOTSTRAP",
        entityType: "PlatformAdmin",
        entityId: pa.id,
        metadata: {
          method: params.method,
          dualIdentity: params.existingMembershipCount > 0,
          existingMembershipCount: params.existingMembershipCount,
        },
      });

      return {
        ok: true,
        platformAdmin: { id: pa.id, status: pa.status },
      };
    });
  }

  private async resolveOrCreateAuthUser(params: {
    email: string;
    password: string;
    name: string;
    onCreated: (id: string) => void;
  }): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { email: params.email },
      select: { authUserId: true },
    });

    if (existing?.authUserId) {
      await this.verifyPassword(params.email, params.password);
      return existing.authUserId;
    }

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: {
        name: params.name,
        platformBootstrap: true,
      },
    });

    if (!error && data.user?.id) {
      params.onCreated(data.user.id);
      return data.user.id;
    }

    const alreadyExists = this.isAlreadyRegisteredError(error?.message);
    if (!alreadyExists) {
      throw new UnauthorizedException("Failed to create auth user");
    }

    const verifiedId = await this.verifyPassword(params.email, params.password);
    return verifiedId;
  }

  private async verifyPassword(email: string, password: string): Promise<string> {
    const supabaseUrl =
      this.configService.get<string>("SUPABASE_PROJECT_URL") ||
      this.configService.get<string>("SUPABASE_URL") ||
      "";
    const anonKey = this.configService.get<string>("SUPABASE_ANON_KEY") || "";
    if (!supabaseUrl || !anonKey) {
      throw new UnauthorizedException("Supabase configuration is missing");
    }

    const anon = createClient(supabaseUrl, anonKey);
    const { data, error } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    const id = data.user?.id;
    if (error || !id) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return id;
  }

  private async compensateDeleteAuthUser(authUserId: string): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.auth.admin.deleteUser(authUserId);
      if (error) {
        this.logger.error(
          `Bootstrap auth compensation failed (id length=${authUserId.length})`,
        );
      }
    } catch {
      this.logger.error("Bootstrap auth compensation threw");
    }
  }

  private assertOwnerEmail(email: string): void {
    const owner = this.ownerEmail();
    if (!owner || owner !== email) {
      throw new ForbiddenException(BOOTSTRAP_NOT_CONFIGURED);
    }
  }

  private assertBootstrapToken(token: string): void {
    const expected = this.bootstrapToken();
    if (!expected) {
      throw new ForbiddenException(BOOTSTRAP_NOT_CONFIGURED);
    }
    if (!this.timingSafeEqualString(expected, token)) {
      throw new UnauthorizedException("Invalid bootstrap token");
    }
  }

  /** Fail closed unless both operator env vars are set. */
  private isBootstrapConfigured(): boolean {
    return Boolean(this.ownerEmail() && this.bootstrapToken());
  }

  private bootstrapToken(): string | null {
    const raw = this.configService.get<string>("PLATFORM_BOOTSTRAP_TOKEN");
    const token = typeof raw === "string" ? raw.trim() : "";
    return token || null;
  }

  private mapUniqueConflict(err: unknown): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return new GoneException(BOOTSTRAP_UNAVAILABLE);
    }
    return err;
  }

  private ownerEmail(): string | null {
    const raw = this.configService.get<string>("PLATFORM_OWNER_EMAIL");
    const email = typeof raw === "string" ? this.normalizeEmail(raw) : "";
    return email || null;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private timingSafeEqualString(a: string, b: string): boolean {
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
  }

  private isAlreadyRegisteredError(message?: string): boolean {
    const msg = (message ?? "").toLowerCase();
    return (
      msg.includes("already been registered") ||
      msg.includes("already registered") ||
      msg.includes("user already exists") ||
      msg.includes("email address has already been registered")
    );
  }
}
