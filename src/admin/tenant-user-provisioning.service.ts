import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { MembershipStatus, Prisma, Role } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { SupabaseService } from "../shared/auth/supabase.service";
import { toPersistedMembershipRole } from "../shared/auth/role-compat";
import {
  assertValidUsername,
  buildInternalAuthEmail,
  normalizeUsername,
} from "../shared/auth/auth-internal-email";
import { assertRoleAllowedByModuleEntitlement } from "../shared/auth/module-role-entitlement";
import {
  isUsernamePasswordOperationalUser,
  mapTenantMembershipToPublicUserDto,
  type PublicAdminUserDto,
} from "./admin-users.mapper";

const MIN_PASSWORD_LENGTH = 8;

/** Roles that may be created via Administration / Platform tenant-user APIs. */
export const TENANT_USER_CREATE_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.TRANSPORT_STAFF,
  Role.FINANCE,
  Role.WAREHOUSE,
  Role.CUSTOMER,
] as const;

export type CreateTenantUserInput = {
  email?: string;
  username?: string;
  name: string;
  phone?: string;
  role: Role;
  /** When false, provision with password instead of invite (office). */
  sendInvite?: boolean;
  password?: string;
  customerCompanyName?: string;
  customerContactName?: string;
  customerContactEmail?: string;
};

export type UpdateTenantUserInput = {
  name?: string;
  phone?: string | null;
  username?: string;
  role?: Role;
  status?: MembershipStatus;
};

export type CreateTenantUserOptions = {
  /**
   * `platform-admin`: require initial password; Active membership; no invite.
   * `tenant-admin`: preserve invite / password dual path.
   */
  mode: "tenant-admin" | "platform-admin";
};

export type UpdateTenantUserOptions = {
  /** Platform Admin MVP forbids username edits (synthetic email sync). */
  allowUsernameEdit: boolean;
};

export type ResetTenantUserPasswordOptions = {
  /** Tenant Admin: warehouse-only. Platform Admin: warehouse + office. */
  allowOfficeReset: boolean;
};

/**
 * Shared tenant-user provisioning used by Administration → Users and
 * Platform Admin → tenant users.
 *
 * ## Password provisioning order (non-atomic across Supabase + Prisma)
 *
 * 1. Validate role / credentials / tenant-scoped uniqueness
 * 2. Resolve auth email (real or synthetic)
 * 3. Create Supabase Auth identity **only when** no existing Prisma authUserId
 *    and password path requires a new identity → record `newlyCreatedAuthUserId`
 * 4. Prisma `$transaction`: upsert User (+ customer links) + upsert Membership
 * 5. On Prisma failure after step 3: compensate by deleting **only**
 *    `newlyCreatedAuthUserId` (never a pre-existing identity)
 * 6. Invite path (tenant-admin only): invite after Prisma succeeds
 *
 * Membership upserts are idempotent on `(tenantId, userId)`. Retries do not
 * create duplicate memberships. Multi-tenant: unrelated memberships are never
 * overwritten.
 */
@Injectable()
export class TenantUserProvisioningService {
  private readonly logger = new Logger(TenantUserProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async createTenantUser(
    tenantId: string,
    dto: CreateTenantUserInput,
    options: CreateTenantUserOptions,
  ): Promise<PublicAdminUserDto> {
    if (dto.role === Role.DRIVER) {
      throw new BadRequestException("Use /admin/drivers to create drivers");
    }
    if (dto.role === Role.OPS) {
      throw new BadRequestException(
        "Cannot create OPS memberships; use TRANSPORT_STAFF",
      );
    }
    if (!TENANT_USER_CREATE_ROLES.includes(dto.role)) {
      throw new BadRequestException(
        `Unsupported role for user creation: ${dto.role}`,
      );
    }

    await assertRoleAllowedByModuleEntitlement(this.prisma, tenantId, dto.role);

    const persistedRole = toPersistedMembershipRole(dto.role);
    const usernameRaw = dto.username?.trim();
    const isUsernameUser = Boolean(usernameRaw);
    const platformMode = options.mode === "platform-admin";

    if (isUsernameUser && persistedRole !== Role.WAREHOUSE) {
      throw new BadRequestException(
        "Username login is only supported for warehouse mobile users",
      );
    }

    let normalizedUsername: string | null = null;
    let authEmail: string;

    if (isUsernameUser) {
      normalizedUsername = normalizeUsername(usernameRaw!);
      try {
        assertValidUsername(normalizedUsername);
      } catch (e: any) {
        throw new BadRequestException(e?.message || "Invalid username");
      }

      const existingInTenant = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId,
          user: { username: normalizedUsername },
        },
        select: { id: true },
      });
      if (existingInTenant) {
        throw new ConflictException("Username is already taken in this tenant");
      }

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { slug: true },
      });
      if (!tenant?.slug) {
        throw new BadRequestException(
          "Tenant slug is required for username users",
        );
      }

      authEmail = buildInternalAuthEmail(tenant.slug, normalizedUsername);
      this.assertPassword(dto.password, "Password (min 8 characters) is required for username-based users");
    } else {
      if (!dto.email?.trim()) {
        throw new BadRequestException("Email is required");
      }
      authEmail = dto.email.trim().toLowerCase();

      if (platformMode) {
        this.assertPassword(
          dto.password,
          "Password (min 8 characters) is required",
        );
      }
    }

    const sendInvite =
      platformMode || isUsernameUser
        ? false
        : dto.sendInvite !== false;

    if (!isUsernameUser && !sendInvite) {
      this.assertPassword(
        dto.password,
        "Password (min 8 characters) is required when not sending an invite",
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: authEmail },
      select: {
        id: true,
        authUserId: true,
        email: true,
        username: true,
        name: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (existingUser) {
      const existingMembership = await this.prisma.tenantMembership.findUnique({
        where: {
          tenantId_userId: { tenantId, userId: existingUser.id },
        },
        include: { user: true },
      });
      if (existingMembership) {
        // Idempotent retry: return existing membership (no duplicate).
        return mapTenantMembershipToPublicUserDto(existingMembership);
      }
    }

    let newlyCreatedAuthUserId: string | null = null;
    let authUserId: string | null = existingUser?.authUserId ?? null;

    const needsPasswordAuthCreate =
      isUsernameUser ||
      (!sendInvite && Boolean(dto.password && dto.password.length >= MIN_PASSWORD_LENGTH));

    try {
      if (needsPasswordAuthCreate && !authUserId) {
        const created = await this.createSupabaseAuthUser({
          email: authEmail,
          password: dto.password!,
          name: dto.name,
          tenantId,
          role: persistedRole,
          username: normalizedUsername,
        });
        authUserId = created.id;
        newlyCreatedAuthUserId = created.id;
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { email: authEmail },
          update: {
            name: dto.name ?? undefined,
            ...(dto.phone !== undefined && { phone: dto.phone }),
            ...(normalizedUsername && { username: normalizedUsername }),
            ...(authUserId && { authUserId }),
          },
          create: {
            email: authEmail,
            name: dto.name ?? null,
            phone: dto.phone ?? null,
            username: normalizedUsername,
            authUserId,
          },
        });

        if (dto.role === Role.CUSTOMER) {
          await this.upsertCustomerLinks(tx, tenantId, user.id, dto, authEmail);
        }

        const membershipStatus: MembershipStatus =
          isUsernameUser || !sendInvite || platformMode
            ? MembershipStatus.Active
            : MembershipStatus.Invited;

        const membership = await tx.tenantMembership.upsert({
          where: { tenantId_userId: { tenantId, userId: user.id } },
          update: {
            role: persistedRole,
            status: membershipStatus,
          },
          create: {
            tenantId,
            userId: user.id,
            role: persistedRole,
            status: membershipStatus,
          },
        });

        return { user, membership };
      });

      if (!isUsernameUser && sendInvite) {
        const supabase = this.supabaseService.getClient();
        const { error } = await supabase.auth.admin.inviteUserByEmail(authEmail);
        if (error) {
          throw new BadRequestException(
            `Supabase invite failed: ${this.sanitizeAuthError(error.message)}`,
          );
        }
      }

      return mapTenantMembershipToPublicUserDto({
        id: result.membership.id,
        role: result.membership.role,
        status: result.membership.status,
        user: {
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
          name: result.user.name,
          phone: result.user.phone,
          createdAt: result.user.createdAt,
          updatedAt: result.user.updatedAt,
        },
      });
    } catch (err) {
      if (newlyCreatedAuthUserId) {
        await this.compensateDeleteAuthUser(newlyCreatedAuthUserId);
      }
      throw err;
    }
  }

  async updateTenantUser(
    tenantId: string,
    userId: string,
    dto: UpdateTenantUserInput,
    options: UpdateTenantUserOptions,
  ): Promise<PublicAdminUserDto> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { user: true },
    });
    if (!membership) {
      throw new NotFoundException("User not found in this tenant");
    }

    if (membership.role === Role.DRIVER || dto.role === Role.DRIVER) {
      throw new BadRequestException("Drivers are managed under Drivers");
    }

    if (dto.role === Role.OPS) {
      throw new BadRequestException(
        "Cannot assign OPS; use TRANSPORT_STAFF",
      );
    }

    const persistedRole =
      dto.role !== undefined ? toPersistedMembershipRole(dto.role) : undefined;

    if (persistedRole !== undefined) {
      if (
        !TENANT_USER_CREATE_ROLES.includes(persistedRole) &&
        persistedRole !== Role.TRANSPORT_STAFF
      ) {
        // TRANSPORT_STAFF is in TENANT_USER_CREATE_ROLES; legacy OPS display only.
        throw new BadRequestException(`Unsupported role: ${dto.role}`);
      }

      await assertRoleAllowedByModuleEntitlement(
        this.prisma,
        tenantId,
        persistedRole,
      );

      const currentIsOperational = isUsernamePasswordOperationalUser({
        role: membership.role,
        username: membership.user.username,
        email: membership.user.email,
      });
      const nextIsWarehouse = persistedRole === Role.WAREHOUSE;
      if (currentIsOperational !== nextIsWarehouse) {
        throw new BadRequestException(
          "Cannot change between username/password operational roles and email/invite office roles on the same user",
        );
      }
    }

    let nextUsername: string | undefined;
    if (dto.username !== undefined) {
      if (!options.allowUsernameEdit) {
        throw new BadRequestException(
          "Username cannot be changed (synthetic auth email would desynchronise)",
        );
      }
      nextUsername = normalizeUsername(dto.username);
      try {
        assertValidUsername(nextUsername);
      } catch (e: any) {
        throw new BadRequestException(e?.message || "Invalid username");
      }
      const clash = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId,
          userId: { not: userId },
          user: { username: nextUsername },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException("Username is already taken in this tenant");
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(nextUsername !== undefined && { username: nextUsername }),
      },
    });

    const updatedMembership = await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: {
        ...(persistedRole !== undefined && { role: persistedRole }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    return mapTenantMembershipToPublicUserDto({
      id: updatedMembership.id,
      role: updatedMembership.role,
      status: updatedMembership.status,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        phone: user.phone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }

  async resetTenantUserPassword(
    tenantId: string,
    userId: string,
    password: string,
    options: ResetTenantUserPasswordOptions,
  ): Promise<{ ok: true }> {
    this.assertPassword(password, "Password must be at least 8 characters");

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { user: true },
    });
    if (!membership) {
      throw new NotFoundException("User not found in this tenant");
    }

    if (membership.role === Role.DRIVER) {
      throw new BadRequestException(
        "Drivers are managed under Drivers",
      );
    }

    const isOperational = isUsernamePasswordOperationalUser({
      role: membership.role,
      username: membership.user.username,
      email: membership.user.email,
    });

    if (!isOperational && !options.allowOfficeReset) {
      throw new BadRequestException(
        "Password reset is only supported for username/password operational users",
      );
    }

    const authUserId = membership.user.authUserId;
    if (!authUserId) {
      throw new BadRequestException(
        "User has no auth account yet; create with a password or send an invite first",
      );
    }

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.auth.admin.updateUserById(authUserId, {
      password,
    });
    if (error) {
      throw new BadRequestException(
        this.sanitizeAuthError(error.message || "Password reset failed"),
      );
    }

    // Supabase updateUserById sets password only; it does not globally revoke
    // all refresh sessions unless project-level settings force it. We do not
    // call signOut / delete sessions here.
    return { ok: true };
  }

  private assertPassword(
    password: string | undefined,
    message: string,
  ): asserts password is string {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      // Message must never echo the submitted password value.
      throw new BadRequestException(message);
    }
  }

  private sanitizeAuthError(message: string): string {
    const msg = String(message || "Auth operation failed");
    if (msg.toLowerCase().includes("auth.opsflow.app")) {
      return "Auth operation failed";
    }
    return msg;
  }

  private async createSupabaseAuthUser(params: {
    email: string;
    password: string;
    name: string;
    tenantId: string;
    role: Role;
    username: string | null;
  }): Promise<{ id: string }> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: {
        name: params.name ?? undefined,
        tenantId: params.tenantId,
        role: String(params.role),
        ...(params.username ? { username: params.username } : {}),
      },
    });
    if (error) {
      throw new BadRequestException(
        this.sanitizeAuthError(error.message || "Failed to create auth user"),
      );
    }
    const id = data.user?.id;
    if (!id) {
      throw new BadRequestException("Failed to create auth user");
    }
    return { id };
  }

  /**
   * Compensating delete for an auth identity created in this request only.
   * Never call for pre-existing / shared identities.
   */
  private async compensateDeleteAuthUser(authUserId: string): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.auth.admin.deleteUser(authUserId);
      if (error) {
        this.logger.error(
          `Compensation deleteUser failed for newly created auth identity (id redacted length=${authUserId.length}): ${this.sanitizeAuthError(error.message)}`,
        );
        throw new BadRequestException(
          "User provisioning failed and auth compensation also failed; contact support with the request correlation id",
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(
        `Compensation deleteUser threw for newly created auth identity`,
      );
      throw new BadRequestException(
        "User provisioning failed and auth compensation also failed; contact support with the request correlation id",
      );
    }
  }

  private normalizeCompanyName(name: string) {
    return String(name ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  private normalizeEmail(email: string) {
    return String(email ?? "")
      .trim()
      .toLowerCase();
  }

  private async upsertCustomerLinks(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: CreateTenantUserInput,
    authEmail: string,
  ) {
    const companyName = String(dto.customerCompanyName ?? "").trim();
    if (!companyName) {
      throw new BadRequestException(
        "customerCompanyName is required for CUSTOMER users",
      );
    }

    const contactName =
      String(dto.customerContactName ?? dto.name ?? "").trim() || "Customer";
    const contactEmail = this.normalizeEmail(
      dto.customerContactEmail ?? authEmail,
    );

    const company = await tx.customer_companies.upsert({
      where: {
        tenantId_normalizedName: {
          tenantId,
          normalizedName: this.normalizeCompanyName(companyName),
        },
      },
      update: { name: companyName },
      create: {
        tenantId,
        name: companyName,
        normalizedName: this.normalizeCompanyName(companyName),
      },
      select: { id: true },
    });

    const contact = await tx.customer_contacts.upsert({
      where: {
        companyId_normalizedEmail: {
          companyId: company.id,
          normalizedEmail: contactEmail,
        },
      },
      update: {
        name: contactName,
        email: contactEmail,
      },
      create: {
        companyId: company.id,
        name: contactName,
        email: contactEmail,
        normalizedEmail: contactEmail,
      },
      select: { id: true },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        customerCompanyId: company.id,
        customerContactId: contact.id,
      },
    });
  }
}
