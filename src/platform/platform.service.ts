import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PlatformAdminStatus,
  TenantModule,
  TenantStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { PlatformAuditService } from "./platform-audit.service";
import {
  CreatePlatformAdminDto,
  CreatePlatformTenantDto,
  SetTenantModulesDto,
  UpdatePlatformAdminDto,
  UpdatePlatformTenantDto,
} from "./dto/platform.dto";
import { parsePaginationFromQuery, buildPaginationMeta } from "../shared/common/pagination";

const ALL_MODULES: TenantModule[] = [
  TenantModule.TRANSPORT,
  TenantModule.WAREHOUSING,
  TenantModule.FINANCE,
];

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
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

    if (
      dto.status === TenantStatus.SUSPENDED ||
      dto.status === TenantStatus.ARCHIVED
    ) {
      // Prefer dedicated suspend/reactivate endpoints for audited lifecycle, but allow PATCH.
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

    // Keep legacy SUPERADMIN bridge for AuthService transition.
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

  private async requireTenant(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException("Tenant not found");
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
