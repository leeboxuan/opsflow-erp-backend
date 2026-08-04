import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { TenantStatus } from "@prisma/client";
import { PlatformService } from "./platform.service";

describe("PlatformService enter/exit tenant (Phase 3)", () => {
  let service: PlatformService;
  let prisma: any;
  let audit: any;
  let tenantUsers: any;

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      platformAuditLog: { create: jest.fn() },
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    tenantUsers = {};
    service = new PlatformService(prisma, audit, tenantUsers);
  });

  const actor = { platformAdminId: "pa-1", userId: "u-1" };

  it("enters ACTIVE tenant and audits PLATFORM_TENANT_ENTERED", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme",
      timezone: null,
      status: TenantStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
      moduleEntitlements: [
        { module: "TRANSPORT", enabled: true },
        { module: "WAREHOUSING", enabled: false },
        { module: "FINANCE", enabled: true },
      ],
      _count: { memberships: 2 },
    });

    const result = await service.enterTenant("t1", actor, "corr-1");
    expect(result.id).toBe("t1");
    expect(result.operable).toBe(true);
    expect(result.tenantSuspended).toBe(false);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLATFORM_TENANT_ENTERED",
        targetTenantId: "t1",
        correlationId: "corr-1",
        metadata: expect.objectContaining({
          tenantStatus: TenantStatus.ACTIVE,
        }),
      }),
    );
  });

  it("enters SUSPENDED tenant with tenantSuspended true", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme",
      timezone: null,
      status: TenantStatus.SUSPENDED,
      createdAt: new Date(),
      updatedAt: new Date(),
      moduleEntitlements: [],
      _count: { memberships: 0 },
    });

    const result = await service.enterTenant("t1", actor, null);
    expect(result.tenantSuspended).toBe(true);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PLATFORM_TENANT_ENTERED" }),
    );
  });

  it("rejects ARCHIVED and audits PLATFORM_TENANT_ENTER_FAILED", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      name: "Acme",
      slug: "acme",
      timezone: null,
      status: TenantStatus.ARCHIVED,
      createdAt: new Date(),
      updatedAt: new Date(),
      moduleEntitlements: [],
      _count: { memberships: 0 },
    });

    await expect(service.enterTenant("t1", actor, "c")).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLATFORM_TENANT_ENTER_FAILED",
        reason: "TENANT_ARCHIVED",
      }),
    );
  });

  it("rejects missing tenant with failed audit", async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(service.enterTenant("missing", actor, null)).rejects.toThrow(
      NotFoundException,
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLATFORM_TENANT_ENTER_FAILED",
        reason: "TENANT_NOT_FOUND",
      }),
    );
  });

  it("audits PLATFORM_TENANT_EXITED on exit", async () => {
    const result = await service.exitTenant("t1", actor, "corr-x");
    expect(result).toEqual({ ok: true, tenantId: "t1" });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLATFORM_TENANT_EXITED",
        targetTenantId: "t1",
        correlationId: "corr-x",
        metadata: { source: "client_reported" },
      }),
    );
  });
});
