import {
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PlatformAdminStatus, TenantModule, TenantStatus } from "@prisma/client";
import { PlatformService } from "./platform.service";
import { PlatformAuditService } from "./platform-audit.service";

describe("PlatformService", () => {
  let service: PlatformService;
  let prisma: any;
  let audit: { append: jest.Mock; redactMetadata: jest.Mock };

  const actor = { platformAdminId: "pa-actor", userId: "user-actor" };

  beforeEach(() => {
    prisma = {
      tenant: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tenantMembership: { count: jest.fn() },
      tenantModuleEntitlement: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      platformAdmin: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      platformAuditLog: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (ops: unknown) => {
        if (Array.isArray(ops)) {
          return Promise.all(ops as Promise<unknown>[]);
        }
        return (ops as (tx: unknown) => Promise<unknown>)(prisma);
      }),
    };

    audit = {
      append: jest.fn().mockResolvedValue(undefined),
      redactMetadata: jest.fn((m) => m),
    };

    const tenantUsers = {
      createTenantUser: jest.fn(),
      updateTenantUser: jest.fn(),
      resetTenantUserPassword: jest.fn(),
    };

    service = new PlatformService(
      prisma,
      audit as unknown as PlatformAuditService,
      tenantUsers as any,
    );
  });

  it("creates a tenant and audits", async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    prisma.tenant.create.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme",
      timezone: null,
      status: TenantStatus.SETUP,
      createdAt: new Date(),
      updatedAt: new Date(),
      moduleEntitlements: [
        { module: TenantModule.TRANSPORT, enabled: true },
      ],
      _count: { memberships: 0 },
    });

    const result = await service.createTenant(
      { name: "Acme", slug: "acme", modules: [TenantModule.TRANSPORT] },
      actor,
    );

    expect(result.slug).toBe("acme");
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TENANT_CREATE", targetTenantId: "t1" }),
    );
  });

  it("rejects slug change when memberships exist", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      slug: "acme",
      _count: { memberships: 2 },
    });

    await expect(
      service.updateTenant("t1", { slug: "acme-new" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows slug change when no memberships", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      slug: "acme",
      _count: { memberships: 0 },
    });
    prisma.tenant.findFirst.mockResolvedValue(null);
    prisma.tenant.update.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme-new",
      timezone: null,
      status: TenantStatus.SETUP,
      createdAt: new Date(),
      updatedAt: new Date(),
      moduleEntitlements: [],
      _count: { memberships: 0 },
    });

    const result = await service.updateTenant(
      "t1",
      { slug: "acme-new" },
      actor,
    );
    expect(result.slug).toBe("acme-new");
  });

  it("suspends tenant and audits", async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: "t1" });
    prisma.tenant.update.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme",
      timezone: null,
      status: TenantStatus.SUSPENDED,
      createdAt: new Date(),
      updatedAt: new Date(),
      moduleEntitlements: [],
      _count: { memberships: 1 },
    });

    const result = await service.suspendTenant("t1", "non-payment", actor);
    expect(result.status).toBe(TenantStatus.SUSPENDED);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TENANT_SUSPEND", reason: "non-payment" }),
    );
  });

  it("reactivates tenant and audits", async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: "t1" });
    prisma.tenant.update.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme",
      timezone: null,
      status: TenantStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
      moduleEntitlements: [],
      _count: { memberships: 1 },
    });

    const result = await service.reactivateTenant("t1", "paid", actor);
    expect(result.status).toBe(TenantStatus.ACTIVE);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TENANT_REACTIVATE" }),
    );
  });

  it("gets and sets modules", async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: "t1" });
    prisma.tenantModuleEntitlement.findMany.mockResolvedValue([
      { module: TenantModule.TRANSPORT, enabled: true },
    ]);
    prisma.tenantModuleEntitlement.upsert.mockResolvedValue({});

    const before = await service.getModules("t1");
    expect(before.modules.find((m) => m.module === TenantModule.TRANSPORT)?.enabled).toBe(
      true,
    );

    prisma.tenantModuleEntitlement.findMany.mockResolvedValue([
      { module: TenantModule.TRANSPORT, enabled: false },
      { module: TenantModule.FINANCE, enabled: true },
    ]);

    const after = await service.setModules(
      "t1",
      {
        modules: [
          { module: TenantModule.TRANSPORT, enabled: false },
          { module: TenantModule.FINANCE, enabled: true },
        ],
      },
      actor,
    );
    expect(after.modules.find((m) => m.module === TenantModule.FINANCE)?.enabled).toBe(
      true,
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TENANT_MODULES_SET" }),
    );
  });

  it("creates and disables platform admins with audit", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u-new",
      role: "USER",
    });
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    prisma.platformAdmin.create.mockResolvedValue({
      id: "pa-new",
      userId: "u-new",
      status: PlatformAdminStatus.ACTIVE,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: "u-new", email: "a@b.com", name: null, displayName: null },
    });
    prisma.user.update.mockResolvedValue({});

    const created = await service.createAdmin({ userId: "u-new" }, actor);
    expect(created.id).toBe("pa-new");
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PLATFORM_ADMIN_CREATE" }),
    );

    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-new",
      userId: "u-new",
      status: PlatformAdminStatus.ACTIVE,
      user: { id: "u-new", email: "a@b.com", name: null, displayName: null },
    });
    prisma.platformAdmin.update.mockResolvedValue({
      id: "pa-new",
      userId: "u-new",
      status: PlatformAdminStatus.DISABLED,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: "u-new", email: "a@b.com", name: null, displayName: null },
    });

    const disabled = await service.updateAdmin(
      "pa-new",
      { status: "DISABLED", reason: "offboard" },
      actor,
    );
    expect(disabled.status).toBe(PlatformAdminStatus.DISABLED);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PLATFORM_ADMIN_DISABLE" }),
    );
  });

  it("assertTenantModuleEnabled rejects disabled module", async () => {
    prisma.tenantModuleEntitlement.findUnique.mockResolvedValue({
      enabled: false,
    });
    await expect(
      service.assertTenantModuleEnabled("t1", TenantModule.FINANCE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
