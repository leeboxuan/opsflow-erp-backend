import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { MembershipStatus, Prisma, Role, CanonicalTenantRole } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { SupabaseService } from "../shared/auth/supabase.service";
import {
  assertValidUsername,
  buildInternalAuthEmail,
  normalizeUsername,
} from "../shared/auth/auth-internal-email";
import {
  assertUsernameGloballyAvailable,
  rethrowUsernameUniqueConflict,
} from "../shared/auth/username-uniqueness";
import {
  isTransportDriverRole,
  toCanonicalTenantRole,
} from "../shared/auth/canonical-tenant-role";
import {
  actorRolesFromTenantContext,
  assertActorCanAdministerTarget,
  assertActorCanAssignRoles,
  assertModulesEnabledForRoles,
  assertValidRoleCombination,
  parseCanonicalRoleList,
} from "../shared/auth/tenant-role-assignment";
import {
  legacyRoleForCanonicalSet,
  syncMembershipRoleRows,
} from "../shared/auth/membership-roles";
import { clearTenantContextCache } from "../shared/auth/tenant-context.cache";
import {
  isUsernamePasswordOperationalUser,
  mapTenantMembershipToPublicUserDto,
  type PublicAdminUserDto,
} from "./admin-users.mapper";

const MIN_PASSWORD_LENGTH = 8;

/** Roles that may be created via Administration / Platform tenant-user APIs. */
export const TENANT_USER_CREATE_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.TRANSPORT_ADMIN,
  CanonicalTenantRole.FINANCE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
  CanonicalTenantRole.CUSTOMER_ADMIN,
] as const;

export type CreateTenantUserInput = {
  email?: string;
  username?: string;
  name: string;
  phone?: string;
  /** @deprecated Prefer `roles`. */
  role?: Role | string;
  roles?: string[] | CanonicalTenantRole[];
  /** When false, provision with password instead of invite (office). */
  sendInvite?: boolean;
  password?: string;
  customerCompanyId?: string;
  customerCompanyName?: string;
  customerContactName?: string;
  customerContactEmail?: string;
};

export type UpdateTenantUserInput = {
  name?: string;
  phone?: string | null;
  username?: string;
  /** @deprecated Prefer replaceUserRoles. */
  role?: Role | string;
  roles?: string[] | CanonicalTenantRole[];
  status?: MembershipStatus;
};

export type CreateTenantUserOptions = {
  /**
   * `platform-admin`: require initial password; Active membership; no invite.
   * `tenant-admin`: preserve invite / password dual path.
   */
  mode: "tenant-admin" | "platform-admin";
  actorRoles?: Array<Role | CanonicalTenantRole | string>;
  actorUserId?: string | null;
  tenantContext?: {
    roles?: Array<Role | CanonicalTenantRole | string>;
    role?: Role | string;
    isPlatformAdmin?: boolean;
    authMode?: string;
  };
};

export type UpdateTenantUserOptions = {
  /** Platform Admin MVP forbids username edits (synthetic email sync). */
  allowUsernameEdit: boolean;
  actorRoles?: Array<Role | CanonicalTenantRole | string>;
  actorUserId?: string | null;
  tenantContext?: CreateTenantUserOptions["tenantContext"];
};

export type ResetTenantUserPasswordOptions = {
  /** Tenant Admin: warehouse-only. Platform Admin: warehouse + office. */
  allowOfficeReset: boolean;
  actorRoles?: Array<Role | CanonicalTenantRole | string>;
  tenantContext?: CreateTenantUserOptions["tenantContext"];
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
    const canonicalRoles = this.resolveRequestedRoles(dto);
    if (canonicalRoles.some((role) => isTransportDriverRole(role))) {
      throw new BadRequestException(
        "Use /admin/drivers to create TRANSPORT_DRIVER users so a Driver profile is provisioned",
      );
    }
    if (String(dto.role ?? "").toUpperCase() === Role.OPS) {
      throw new BadRequestException(
        "Cannot create OPS memberships; use TRANSPORT_ADMIN",
      );
    }
    const unsupported = canonicalRoles.filter(
      (role) => !TENANT_USER_CREATE_ROLES.includes(role),
    );
    if (unsupported.length) {
      throw new BadRequestException(
        `Unsupported role for user creation: ${unsupported.join(", ")}`,
      );
    }

    assertValidRoleCombination(canonicalRoles);
    const actorRoles = this.resolveActorRoles(options);
    assertActorCanAssignRoles(actorRoles, canonicalRoles);
    await assertModulesEnabledForRoles(this.prisma, tenantId, canonicalRoles);

    if (canonicalRoles.includes(CanonicalTenantRole.CUSTOMER_ADMIN)) {
      const companyId = dto.customerCompanyId?.trim();
      const companyName = dto.customerCompanyName?.trim();
      if (!companyId && !companyName) {
        throw new BadRequestException(
          "customerCompanyId is required for CUSTOMER_ADMIN",
        );
      }
    }

    const persistedRole = legacyRoleForCanonicalSet(canonicalRoles, dto.role);
    const usernameRaw = dto.username?.trim();
    const isUsernameUser = Boolean(usernameRaw);
    const platformMode = options.mode === "platform-admin";
    const warehouseUsernameAllowed = canonicalRoles.every(
      (role) =>
        role === CanonicalTenantRole.WAREHOUSE_STAFF ||
        role === CanonicalTenantRole.WAREHOUSE_ADMIN,
    );

    if (isUsernameUser && !warehouseUsernameAllowed) {
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

      await assertUsernameGloballyAvailable(this.prisma, normalizedUsername);

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
        include: { user: true, membershipRoles: { select: { role: true } } },
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

        if (canonicalRoles.includes(CanonicalTenantRole.CUSTOMER_ADMIN)) {
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

        await syncMembershipRoleRows(
          tx,
          membership.id,
          canonicalRoles,
          options.actorUserId ?? null,
        );

        return { user, membership, canonicalRoles };
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
        membershipRoles: canonicalRoles.map((role) => ({ role })),
        user: {
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
          name: result.user.name,
          phone: result.user.phone,
          customerCompanyId: result.user.customerCompanyId,
          createdAt: result.user.createdAt,
          updatedAt: result.user.updatedAt,
        },
      });
    } catch (err) {
      if (newlyCreatedAuthUserId) {
        await this.compensateDeleteAuthUser(newlyCreatedAuthUserId);
      }
      rethrowUsernameUniqueConflict(err);
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
      include: {
        user: true,
        membershipRoles: { select: { role: true } },
      },
    });
    if (!membership) {
      throw new NotFoundException("User not found in this tenant");
    }

    const actorRoles = this.resolveActorRoles({
      mode: "tenant-admin",
      actorRoles: options.actorRoles,
      tenantContext: options.tenantContext,
    });
    assertActorCanAdministerTarget(
      actorRoles,
      this.rolesFromMembership(membership),
    );

    if (String(dto.role ?? "").toUpperCase() === Role.OPS) {
      throw new BadRequestException(
        "Cannot assign OPS; use TRANSPORT_ADMIN",
      );
    }

    const nextRoles =
      dto.roles !== undefined
        ? parseCanonicalRoleList(dto.roles)
        : dto.role !== undefined
          ? this.resolveRequestedRoles({ role: dto.role })
          : undefined;

    if (nextRoles) {
      await this.replaceUserRoles(tenantId, userId, nextRoles, {
        actorRoles: options.actorRoles,
        actorUserId: options.actorUserId,
        tenantContext: options.tenantContext,
      });
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
      await assertUsernameGloballyAvailable(this.prisma, nextUsername, userId);
    }

    let user;
    try {
      user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(nextUsername !== undefined && { username: nextUsername }),
        },
      });
    } catch (err) {
      rethrowUsernameUniqueConflict(err);
      throw err;
    }

    const updatedMembership = await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: { membershipRoles: { select: { role: true } } },
    });

    return mapTenantMembershipToPublicUserDto({
      id: updatedMembership.id,
      role: updatedMembership.role,
      status: updatedMembership.status,
      membershipRoles: updatedMembership.membershipRoles,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        phone: user.phone,
        customerCompanyId: user.customerCompanyId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }

  async replaceUserRoles(
    tenantId: string,
    userId: string,
    rolesInput: readonly string[],
    options: {
      actorRoles?: Array<Role | CanonicalTenantRole | string>;
      actorUserId?: string | null;
      tenantContext?: CreateTenantUserOptions["tenantContext"];
    } = {},
  ): Promise<PublicAdminUserDto> {
    const nextRoles = parseCanonicalRoleList(rolesInput);
    assertValidRoleCombination(nextRoles);
    const actorRoles = this.resolveActorRoles({
      mode: "tenant-admin",
      actorRoles: options.actorRoles,
      tenantContext: options.tenantContext,
    });
    assertActorCanAssignRoles(actorRoles, nextRoles);
    await assertModulesEnabledForRoles(this.prisma, tenantId, nextRoles);

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: {
        user: true,
        membershipRoles: { select: { role: true } },
      },
    });
    if (!membership) {
      throw new NotFoundException("User not found in this tenant");
    }

    const previousRoles = this.rolesFromMembership(membership);
    assertActorCanAdministerTarget(actorRoles, previousRoles);

    if (nextRoles.includes(CanonicalTenantRole.TRANSPORT_DRIVER)) {
      const driver = await this.prisma.drivers.findFirst({
        where: { tenantId, userId },
        select: { id: true },
      });
      if (!driver) {
        throw new BadRequestException(
          "Use /admin/drivers to create TRANSPORT_DRIVER users so a Driver profile is provisioned",
        );
      }
    }

    if (nextRoles.includes(CanonicalTenantRole.CUSTOMER_ADMIN)) {
      if (!membership.user.customerCompanyId) {
        throw new BadRequestException(
          "customerCompanyId is required for CUSTOMER_ADMIN",
        );
      }
    }

    const currentIsOperational = isUsernamePasswordOperationalUser({
      role: membership.role,
      roles: previousRoles,
      username: membership.user.username,
      email: membership.user.email,
    });
    const nextIsWarehouseUsername =
      nextRoles.includes(CanonicalTenantRole.WAREHOUSE_STAFF) &&
      nextRoles.every(
        (role) =>
          role === CanonicalTenantRole.WAREHOUSE_STAFF ||
          role === CanonicalTenantRole.WAREHOUSE_ADMIN,
      );
    if (currentIsOperational !== nextIsWarehouseUsername && currentIsOperational !== nextRoles.includes(CanonicalTenantRole.WAREHOUSE_STAFF)) {
      throw new BadRequestException(
        "Cannot change between username/password operational roles and email/invite office roles on the same user",
      );
    }

    const persistedRole = legacyRoleForCanonicalSet(nextRoles, membership.role);

    await this.prisma.$transaction(async (tx) => {
      await tx.tenantMembership.update({
        where: { id: membership.id },
        data: { role: persistedRole },
      });
      await syncMembershipRoleRows(
        tx,
        membership.id,
        nextRoles,
        options.actorUserId ?? null,
      );
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: options.actorUserId ?? null,
        entityType: "TenantMembership",
        entityId: membership.id,
        action: "ROLE_ASSIGN",
        metadata: {
          previousRoles,
          newRoles: nextRoles,
          changedBy: options.actorUserId ?? null,
          timestamp: new Date().toISOString(),
        },
      },
    });

    clearTenantContextCache(userId, tenantId);

    const updated = await this.prisma.tenantMembership.findUnique({
      where: { id: membership.id },
      include: {
        user: true,
        membershipRoles: { select: { role: true } },
      },
    });
    if (!updated) {
      throw new NotFoundException("User not found in this tenant");
    }
    return mapTenantMembershipToPublicUserDto(updated);
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
      include: {
        user: true,
        membershipRoles: { select: { role: true } },
      },
    });
    if (!membership) {
      throw new NotFoundException("User not found in this tenant");
    }

    const targetRoles = this.rolesFromMembership(membership);
    if (options.actorRoles || options.tenantContext) {
      assertActorCanAdministerTarget(
        this.resolveActorRoles({
          mode: "tenant-admin",
          actorRoles: options.actorRoles,
          tenantContext: options.tenantContext,
        }),
        targetRoles,
      );
    }

    if (targetRoles.includes(CanonicalTenantRole.TRANSPORT_DRIVER)) {
      throw new BadRequestException(
        "Drivers are managed under Drivers",
      );
    }

    const isOperational = isUsernamePasswordOperationalUser({
      role: membership.role,
      username: membership.user.username,
      email: membership.user.email,
    });
    const isCustomerAdmin = targetRoles.includes(
      CanonicalTenantRole.CUSTOMER_ADMIN,
    );

    if (!isOperational && !options.allowOfficeReset && !isCustomerAdmin) {
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
    const companyIdRaw = String(dto.customerCompanyId ?? "").trim();
    if (!companyName && !companyIdRaw) {
      throw new BadRequestException(
        "customerCompanyId is required for CUSTOMER_ADMIN",
      );
    }

    const contactName =
      String(dto.customerContactName ?? dto.name ?? "").trim() || "Customer";
    const contactEmail = this.normalizeEmail(
      dto.customerContactEmail ?? authEmail,
    );

    const company = companyIdRaw
      ? await tx.customer_companies.findFirst({
          where: { id: companyIdRaw, tenantId },
          select: { id: true },
        })
      : await tx.customer_companies.upsert({
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

    if (!company) {
      throw new BadRequestException("Customer company not found in this tenant");
    }

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

  private resolveRequestedRoles(dto: {
    role?: Role | string;
    roles?: string[] | CanonicalTenantRole[];
  }): CanonicalTenantRole[] {
    if (dto.roles?.length) {
      return parseCanonicalRoleList(dto.roles);
    }
    const mapped = toCanonicalTenantRole(dto.role);
    if (!mapped) {
      throw new BadRequestException("roles is required");
    }
    return [mapped];
  }

  private resolveActorRoles(options: {
    mode?: "tenant-admin" | "platform-admin";
    actorRoles?: Array<Role | CanonicalTenantRole | string>;
    tenantContext?: CreateTenantUserOptions["tenantContext"];
  }): CanonicalTenantRole[] {
    if (options.mode === "platform-admin") {
      return [CanonicalTenantRole.TENANT_ADMIN];
    }
    if (options.actorRoles?.length) {
      return parseCanonicalRoleList(options.actorRoles);
    }
    if (options.tenantContext) {
      return actorRolesFromTenantContext(options.tenantContext);
    }
    return [CanonicalTenantRole.TENANT_ADMIN];
  }

  private rolesFromMembership(membership: {
    role?: Role | string | null;
    membershipRoles?: Array<{ role?: CanonicalTenantRole | string }> | null;
  }): CanonicalTenantRole[] {
    if (membership.membershipRoles?.length) {
      return parseCanonicalRoleList(
        membership.membershipRoles.map((row) => String(row.role)),
      );
    }
    const mapped = toCanonicalTenantRole(membership.role);
    return mapped ? [mapped] : [];
  }
}
