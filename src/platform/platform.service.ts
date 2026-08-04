import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  MembershipStatus,
  PlatformAdminStatus,
  Role,
  TenantModule,
  TenantStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { PlatformAuditService } from "./platform-audit.service";
import {
  CreatePlatformAdminDto,
  CreatePlatformTenantDto,
  CreatePlatformTenantUserDto,
  SetTenantModulesDto,
  UpdatePlatformAdminDto,
  UpdatePlatformTenantDto,
  UpdatePlatformTenantUserDto,
} from "./dto/platform.dto";
import { parsePaginationFromQuery, buildPaginationMeta } from "../shared/common/pagination";
import { listTenantUsers } from "../admin/admin-users.list";
import { TenantUserProvisioningService } from "../admin/tenant-user-provisioning.service";
import type { PublicAdminUserDto } from "../admin/admin-users.mapper";

const ALL_MODULES: TenantModule[] = [
  TenantModule.TRANSPORT,
  TenantModule.WAREHOUSING,
  TenantModule.FINANCE,
];

const MANAGEABLE_TENANT_STATUSES: TenantStatus[] = [
  TenantStatus.ACTIVE,
  TenantStatus.SETUP,
  TenantStatus.SUSPENDED,
];

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly tenantUsers: TenantUserProvisioningService,
  ) {}

  async getMe(platformAdminId: string, userId: string) {
    const pa = await this.prisma.platformAdmin.findFirst({
      where: { id: platformAdminId, userId },
      include: {
        user: {
          select: { id: true, email: true, name: true, displayName: true },
        },
      },
    });
    if (!pa) throw new NotFoundException("Platform admin not found");
    return {
      id: pa.id,
      status: pa.status,
      user: pa.user,
      createdAt: pa.createdAt,
    };
  }

  async listTenants(query: { q?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const where: any = {};
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          moduleEntitlements: true,
          _count: { select: { memberships: true } },
        },
      }),
    ]);
    return {
      data: rows.map((t) => this.mapTenant(t)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getTenant(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        moduleEntitlements: true,
        _count: { select: { memberships: true } },
      },
    });
    if (!t) throw new NotFoundException("Tenant not found");
    return this.mapTenant(t);
  }

  /**
   * Phase 3: validate selected tenant for operational access and audit entry.
   * Does not create TenantMembership. Client then uses X-Tenant-Id on ops routes.
   */
  async enterTenant(
    tenantId: string,
    actor: { platformAdminId: string; userId: string },
    correlationId?: string | null,
  ) {
    try {
      const t = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          moduleEntitlements: true,
          _count: { select: { memberships: true } },
        },
      });
      if (!t) {
        await this.audit.append({
          actorPlatformAdminId: actor.platformAdminId,
          actorUserId: actor.userId,
          action: "PLATFORM_TENANT_ENTER_FAILED",
          targetTenantId: tenantId,
          entityType: "Tenant",
          entityId: tenantId,
          correlationId: correlationId ?? null,
          reason: "TENANT_NOT_FOUND",
          metadata: { outcome: "rejected" },
        });
        throw new NotFoundException("Tenant not found");
      }

      if (t.status === TenantStatus.ARCHIVED) {
        await this.audit.append({
          actorPlatformAdminId: actor.platformAdminId,
          actorUserId: actor.userId,
          action: "PLATFORM_TENANT_ENTER_FAILED",
          targetTenantId: tenantId,
          entityType: "Tenant",
          entityId: tenantId,
          correlationId: correlationId ?? null,
          reason: "TENANT_ARCHIVED",
          metadata: { status: t.status, outcome: "rejected" },
        });
        throw new ForbiddenException(
          "Tenant is archived — use /platform APIs for management",
        );
      }

      if (
        t.status !== TenantStatus.ACTIVE &&
        t.status !== TenantStatus.SETUP &&
        t.status !== TenantStatus.SUSPENDED
      ) {
        await this.audit.append({
          actorPlatformAdminId: actor.platformAdminId,
          actorUserId: actor.userId,
          action: "PLATFORM_TENANT_ENTER_FAILED",
          targetTenantId: tenantId,
          entityType: "Tenant",
          entityId: tenantId,
          correlationId: correlationId ?? null,
          reason: "TENANT_STATUS_NOT_ALLOWED",
          metadata: { status: t.status, outcome: "rejected" },
        });
        throw new ForbiddenException(`Tenant status ${t.status} is not operable`);
      }

      const mapped = this.mapTenant(t);
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_ENTERED",
        targetTenantId: tenantId,
        entityType: "Tenant",
        entityId: tenantId,
        correlationId: correlationId ?? null,
        metadata: {
          tenantStatus: mapped.status,
          tenantSuspended: mapped.status === TenantStatus.SUSPENDED,
          modules: mapped.modules,
        },
      });

      return {
        ...mapped,
        tenantSuspended: mapped.status === TenantStatus.SUSPENDED,
        operable: true,
      };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_ENTER_FAILED",
        targetTenantId: tenantId,
        entityType: "Tenant",
        entityId: tenantId,
        correlationId: correlationId ?? null,
        reason: "UNEXPECTED",
        metadata: { outcome: "rejected" },
      });
      throw err;
    }
  }

  /**
   * Phase 3: audit operational exit when the client reports it.
   * Exit itself is client-local (clears selected tenant); this records the event.
   */
  async exitTenant(
    tenantId: string,
    actor: { platformAdminId: string; userId: string },
    correlationId?: string | null,
  ) {
    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "PLATFORM_TENANT_EXITED",
      targetTenantId: tenantId,
      entityType: "Tenant",
      entityId: tenantId,
      correlationId: correlationId ?? null,
      metadata: { source: "client_reported" },
    });
    return { ok: true, tenantId };
  }

  async createTenant(
    dto: CreatePlatformTenantDto,
    actor: { platformAdminId: string; userId: string },
  ) {
    const slug = dto.slug.trim().toLowerCase();
    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Tenant slug already exists: ${slug}`);
    }

    const status = dto.status ?? TenantStatus.SETUP;
    const modules = dto.modules?.length ? dto.modules : ALL_MODULES;

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.name.trim(),
        slug,
        timezone: dto.timezone ?? null,
        status,
        moduleEntitlements: {
          create: modules.map((module) => ({
            module,
            enabled: true,
          })),
        },
      },
      include: {
        moduleEntitlements: true,
        _count: { select: { memberships: true } },
      },
    });

    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "TENANT_CREATE",
      targetTenantId: tenant.id,
      entityType: "Tenant",
      entityId: tenant.id,
      metadata: { slug: tenant.slug, status: tenant.status, modules },
    });

    return this.mapTenant(tenant);
  }

  async updateTenant(
    tenantId: string,
    dto: UpdatePlatformTenantDto,
    actor: { platformAdminId: string; userId: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");

    if (dto.slug !== undefined && dto.slug.trim().toLowerCase() !== tenant.slug) {
      if (tenant._count.memberships > 0) {
        throw new BadRequestException(
          "Tenant slug is immutable once tenant users/memberships exist",
        );
      }
      const slug = dto.slug.trim().toLowerCase();
      const clash = await this.prisma.tenant.findFirst({
        where: { slug, NOT: { id: tenantId } },
      });
      if (clash) throw new ConflictException(`Tenant slug already exists: ${slug}`);
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.slug !== undefined
          ? { slug: dto.slug.trim().toLowerCase() }
          : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: {
        moduleEntitlements: true,
        _count: { select: { memberships: true } },
      },
    });

    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "TENANT_UPDATE",
      targetTenantId: tenantId,
      entityType: "Tenant",
      entityId: tenantId,
      metadata: { patch: dto },
    });

    return this.mapTenant(updated);
  }

  async suspendTenant(
    tenantId: string,
    reason: string | undefined,
    actor: { platformAdminId: string; userId: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException("Tenant not found");

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: TenantStatus.SUSPENDED },
      include: {
        moduleEntitlements: true,
        _count: { select: { memberships: true } },
      },
    });

    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "TENANT_SUSPEND",
      targetTenantId: tenantId,
      entityType: "Tenant",
      entityId: tenantId,
      reason: reason ?? null,
    });

    return this.mapTenant(updated);
  }

  async reactivateTenant(
    tenantId: string,
    reason: string | undefined,
    actor: { platformAdminId: string; userId: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException("Tenant not found");

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: TenantStatus.ACTIVE },
      include: {
        moduleEntitlements: true,
        _count: { select: { memberships: true } },
      },
    });

    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "TENANT_REACTIVATE",
      targetTenantId: tenantId,
      entityType: "Tenant",
      entityId: tenantId,
      reason: reason ?? null,
    });

    return this.mapTenant(updated);
  }

  async getModules(tenantId: string) {
    await this.requireTenant(tenantId);
    const rows = await this.prisma.tenantModuleEntitlement.findMany({
      where: { tenantId },
      orderBy: { module: "asc" },
    });
    const byModule = new Map<TenantModule, { module: TenantModule; enabled: boolean }>(
      rows.map((r) => [r.module, { module: r.module, enabled: r.enabled }]),
    );
    return {
      tenantId,
      modules: ALL_MODULES.map((module) => ({
        module,
        enabled: byModule.get(module)?.enabled ?? false,
      })),
    };
  }

  async setModules(
    tenantId: string,
    dto: SetTenantModulesDto,
    actor: { platformAdminId: string; userId: string },
  ) {
    await this.requireTenant(tenantId);
    if (!Array.isArray(dto.modules) || dto.modules.length === 0) {
      throw new BadRequestException("modules array is required");
    }

    for (const entry of dto.modules) {
      if (!ALL_MODULES.includes(entry.module)) {
        throw new BadRequestException(`Invalid module: ${entry.module}`);
      }
      await this.prisma.tenantModuleEntitlement.upsert({
        where: {
          tenantId_module: { tenantId, module: entry.module },
        },
        create: {
          tenantId,
          module: entry.module,
          enabled: entry.enabled === true,
        },
        update: { enabled: entry.enabled === true },
      });
    }

    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "TENANT_MODULES_SET",
      targetTenantId: tenantId,
      entityType: "TenantModuleEntitlement",
      entityId: tenantId,
      metadata: { modules: dto.modules },
    });

    return this.getModules(tenantId);
  }

  /**
   * Phase 1: enforce module entitlement on platform config APIs.
   * Phase 3 will tighten operational route-family gates.
   */
  async assertTenantModuleEnabled(
    tenantId: string,
    module: TenantModule,
  ): Promise<void> {
    const row = await this.prisma.tenantModuleEntitlement.findUnique({
      where: { tenantId_module: { tenantId, module } },
    });
    if (!row?.enabled) {
      throw new ForbiddenException(
        `Tenant module ${module} is not enabled (Phase 1 platform gate; Phase 3 tightens ops routes)`,
      );
    }
  }

  async listAdmins() {
    const rows = await this.prisma.platformAdmin.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, email: true, name: true, displayName: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      notes: r.notes,
      userId: r.userId,
      user: r.user,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async createAdmin(
    dto: CreatePlatformAdminDto,
    actor: { platformAdminId: string; userId: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException("User not found");

    const existing = await this.prisma.platformAdmin.findUnique({
      where: { userId: dto.userId },
    });
    if (existing) {
      throw new ConflictException("User is already a platform admin");
    }

    const created = await this.prisma.platformAdmin.create({
      data: {
        userId: dto.userId,
        status: PlatformAdminStatus.ACTIVE,
        createdByUserId: actor.userId,
        notes: dto.notes ?? null,
      },
      include: {
        user: {
          select: { id: true, email: true, name: true, displayName: true },
        },
      },
    });

    if (user.role !== UserRole.SUPERADMIN) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { role: UserRole.SUPERADMIN },
      });
    }

    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "PLATFORM_ADMIN_CREATE",
      entityType: "PlatformAdmin",
      entityId: created.id,
      metadata: { targetUserId: dto.userId },
    });

    return {
      id: created.id,
      status: created.status,
      notes: created.notes,
      userId: created.userId,
      user: created.user,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async updateAdmin(
    adminId: string,
    dto: UpdatePlatformAdminDto,
    actor: { platformAdminId: string; userId: string },
  ) {
    const target = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      include: {
        user: {
          select: { id: true, email: true, name: true, displayName: true },
        },
      },
    });
    if (!target) throw new NotFoundException("Platform admin not found");

    if (dto.status === "DISABLED" && target.id === actor.platformAdminId) {
      throw new BadRequestException("Cannot disable your own platform admin account");
    }

    const nextStatus =
      dto.status === "DISABLED"
        ? PlatformAdminStatus.DISABLED
        : dto.status === "ACTIVE"
          ? PlatformAdminStatus.ACTIVE
          : undefined;

    const updated = await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: {
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: {
        user: {
          select: { id: true, email: true, name: true, displayName: true },
        },
      },
    });

    if (nextStatus === PlatformAdminStatus.DISABLED) {
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_ADMIN_DISABLE",
        entityType: "PlatformAdmin",
        entityId: adminId,
        reason: dto.reason ?? null,
      });
    } else if (nextStatus === PlatformAdminStatus.ACTIVE) {
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_ADMIN_ENABLE",
        entityType: "PlatformAdmin",
        entityId: adminId,
        reason: dto.reason ?? null,
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      notes: updated.notes,
      userId: updated.userId,
      user: updated.user,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async listAudit(query: {
    targetTenantId?: string;
    action?: string;
    page?: string;
    pageSize?: string;
  }) {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const where: any = {};
    if (query.targetTenantId) where.targetTenantId = query.targetTenantId;
    if (query.action) where.action = query.action;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.platformAuditLog.count({ where }),
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    return {
      data: rows,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  // ─── Phase 2: tenant users ───────────────────────────────────────────

  async listTenantUsers(
    tenantId: string,
    query: {
      q?: string;
      page?: string | number;
      pageSize?: string | number;
      filter?: string;
      role?: Role;
      roles?: string;
      sortBy?: string;
      sortDir?: "asc" | "desc";
    },
  ) {
    await this.requireManageableTenant(tenantId);
    return listTenantUsers(
      this.prisma,
      tenantId,
      {
        page: query.page !== undefined ? Number(query.page) : undefined,
        pageSize:
          query.pageSize !== undefined ? Number(query.pageSize) : undefined,
        q: query.q,
        filter: query.filter,
        role: query.role,
        roles: query.roles,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
      { excludeDriver: true },
    );
  }

  async createTenantUser(
    tenantId: string,
    dto: CreatePlatformTenantUserDto,
    actor: { platformAdminId: string; userId: string },
    correlationId?: string | null,
  ): Promise<PublicAdminUserDto> {
    await this.requireManageableTenant(tenantId);

    const safeMetaBase = {
      role: dto.role,
      hasUsername: Boolean(dto.username?.trim()),
      hasEmail: Boolean(dto.email?.trim()),
      name: dto.name,
    };

    try {
      const created = await this.tenantUsers.createTenantUser(
        tenantId,
        {
          email: dto.email,
          username: dto.username,
          name: dto.name,
          phone: dto.phone,
          role: dto.role,
          password: dto.password,
          sendInvite: false,
          customerCompanyName: dto.customerCompanyName,
          customerContactName: dto.customerContactName,
          customerContactEmail: dto.customerContactEmail,
        },
        { mode: "platform-admin" },
      );

      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_USER_CREATED",
        targetTenantId: tenantId,
        entityType: "TenantMembership",
        entityId: created.membershipId,
        correlationId: correlationId ?? null,
        metadata: {
          ...safeMetaBase,
          userId: created.id,
          membershipId: created.membershipId,
          role: created.role,
          status: created.status,
        },
      });

      return created;
    } catch (err) {
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_USER_CREATE_FAILED",
        targetTenantId: tenantId,
        entityType: "TenantMembership",
        entityId: null,
        correlationId: correlationId ?? null,
        reason: err instanceof Error ? err.message : "create failed",
        metadata: safeMetaBase,
      });
      throw err;
    }
  }

  async updateTenantUser(
    tenantId: string,
    userId: string,
    dto: UpdatePlatformTenantUserDto,
    actor: { platformAdminId: string; userId: string },
    correlationId?: string | null,
  ): Promise<PublicAdminUserDto> {
    await this.requireManageableTenant(tenantId);

    const before = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { id: true, role: true, status: true },
    });
    if (!before) throw new NotFoundException("User not found in this tenant");

    const updated = await this.tenantUsers.updateTenantUser(
      tenantId,
      userId,
      {
        name: dto.name,
        phone: dto.phone,
        role: dto.role,
        status: dto.status,
      },
      { allowUsernameEdit: false },
    );

    const roleChanged =
      dto.role !== undefined && before.role !== updated.role;
    const deactivated =
      dto.status === MembershipStatus.Suspended &&
      before.status !== MembershipStatus.Suspended;
    const reactivated =
      dto.status === MembershipStatus.Active &&
      before.status !== MembershipStatus.Active;

    if (roleChanged) {
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_USER_ROLE_CHANGED",
        targetTenantId: tenantId,
        entityType: "TenantMembership",
        entityId: updated.membershipId,
        correlationId: correlationId ?? null,
        metadata: {
          userId,
          fromRole: before.role,
          toRole: updated.role,
        },
      });
    }

    if (deactivated) {
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_USER_DEACTIVATED",
        targetTenantId: tenantId,
        entityType: "TenantMembership",
        entityId: updated.membershipId,
        correlationId: correlationId ?? null,
        metadata: { userId, status: updated.status },
      });
    } else if (reactivated) {
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_USER_REACTIVATED",
        targetTenantId: tenantId,
        entityType: "TenantMembership",
        entityId: updated.membershipId,
        correlationId: correlationId ?? null,
        metadata: { userId, status: updated.status },
      });
    }

    await this.audit.append({
      actorPlatformAdminId: actor.platformAdminId,
      actorUserId: actor.userId,
      action: "PLATFORM_TENANT_USER_UPDATED",
      targetTenantId: tenantId,
      entityType: "TenantMembership",
      entityId: updated.membershipId,
      correlationId: correlationId ?? null,
      metadata: {
        userId,
        patch: {
          name: dto.name !== undefined,
          phone: dto.phone !== undefined,
          role: dto.role,
          status: dto.status,
        },
      },
    });

    return updated;
  }

  async resetTenantUserPassword(
    tenantId: string,
    userId: string,
    password: string,
    actor: { platformAdminId: string; userId: string },
    correlationId?: string | null,
  ): Promise<{ ok: true }> {
    await this.requireManageableTenant(tenantId);

    try {
      const result = await this.tenantUsers.resetTenantUserPassword(
        tenantId,
        userId,
        password,
        { allowOfficeReset: true },
      );

      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_USER_PASSWORD_RESET",
        targetTenantId: tenantId,
        entityType: "User",
        entityId: userId,
        correlationId: correlationId ?? null,
        metadata: { userId, passwordReset: true },
      });

      return result;
    } catch (err) {
      await this.audit.append({
        actorPlatformAdminId: actor.platformAdminId,
        actorUserId: actor.userId,
        action: "PLATFORM_TENANT_USER_PASSWORD_RESET_FAILED",
        targetTenantId: tenantId,
        entityType: "User",
        entityId: userId,
        correlationId: correlationId ?? null,
        reason: err instanceof Error ? err.message : "reset failed",
        metadata: { userId },
      });
      throw err;
    }
  }

  private async requireTenant(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException("Tenant not found");
    return t;
  }

  /** Platform Admin may manage users in ACTIVE, SETUP, or SUSPENDED tenants. */
  private async requireManageableTenant(tenantId: string) {
    const t = await this.requireTenant(tenantId);
    if (!MANAGEABLE_TENANT_STATUSES.includes(t.status)) {
      throw new BadRequestException(
        `Cannot manage users for tenant status ${t.status}`,
      );
    }
    return t;
  }

  private mapTenant(t: {
    id: string;
    name: string;
    slug: string;
    timezone: string | null;
    status: TenantStatus;
    createdAt: Date;
    updatedAt: Date;
    moduleEntitlements?: Array<{ module: TenantModule; enabled: boolean }>;
    _count?: { memberships: number };
  }) {
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      timezone: t.timezone,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      membershipCount: t._count?.memberships ?? 0,
      modules: (t.moduleEntitlements ?? []).map((m) => ({
        module: m.module,
        enabled: m.enabled,
      })),
    };
  }
}
