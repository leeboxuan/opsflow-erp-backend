import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MembershipStatus, Role, TenantStatus } from "@prisma/client";
import { PlatformService } from "./platform.service";
import { PlatformAuditService } from "./platform-audit.service";

describe("PlatformService tenant users (Phase 2)", () => {
  const actor = { platformAdminId: "pa-1", userId: "actor-1" };

  function makeService() {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: "t1",
          status: TenantStatus.ACTIVE,
          slug: "acme",
          name: "Acme",
        }),
      },
      tenantMembership: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "m-ops",
            role: Role.OPS,
            status: MembershipStatus.Active,
            user: {
              id: "u-ops",
              email: "ops@example.com",
              username: null,
              name: "Legacy Ops",
              phone: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ]),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (ops: unknown) => {
        if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[]);
        return (ops as (tx: unknown) => Promise<unknown>)(prisma);
      }),
    };

    const audit = {
      append: jest.fn().mockResolvedValue(undefined),
      redactMetadata: jest.fn((m: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(m)) {
          out[k] = /password/i.test(k) ? "[REDACTED]" : v;
        }
        return out;
      }),
    };

    const tenantUsers = {
      createTenantUser: jest.fn(),
      updateTenantUser: jest.fn(),
      resetTenantUserPassword: jest.fn(),
    };

    const service = new PlatformService(
      prisma,
      audit as unknown as PlatformAuditService,
      tenantUsers as any,
    );

    return { service, prisma, audit, tenantUsers };
  }

  it("rejects unknown tenant", async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(service.listTenantUsers("missing", {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("allows managing users in SUSPENDED tenants", async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      status: TenantStatus.SUSPENDED,
    });
    await expect(service.listTenantUsers("t1", {})).resolves.toBeDefined();
  });

  it("rejects ARCHIVED tenant user management", async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: "t1",
      status: TenantStatus.ARCHIVED,
    });
    await expect(service.listTenantUsers("t1", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("lists users scoped to tenant and still displays legacy OPS", async () => {
    const { service, prisma } = makeService();
    const result = await service.listTenantUsers("t1", {});
    expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          NOT: { role: Role.DRIVER },
        }),
      }),
    );
    expect(result.data[0]?.role).toBe(Role.OPS);
  });

  it("creates user and audits without password", async () => {
    const { service, tenantUsers, audit } = makeService();
    tenantUsers.createTenantUser.mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      username: null,
      name: "Admin",
      phone: null,
      role: Role.ADMIN,
      status: MembershipStatus.Active,
      membershipId: "m1",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    });

    const result = await service.createTenantUser(
      "t1",
      {
        email: "a@example.com",
        name: "Admin",
        role: Role.ADMIN,
        password: "secret-password-xyz",
      } as any,
      actor,
      "corr-1",
    );

    expect(result.email).toBe("a@example.com");
    expect(JSON.stringify(result)).not.toContain("secret-password-xyz");
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLATFORM_TENANT_USER_CREATED",
        targetTenantId: "t1",
        actorPlatformAdminId: "pa-1",
        correlationId: "corr-1",
        metadata: expect.not.objectContaining({
          password: expect.anything(),
        }),
      }),
    );
    const meta = audit.append.mock.calls[0][0].metadata;
    expect(JSON.stringify(meta)).not.toContain("secret-password-xyz");
  });

  it("audits role change, deactivate, reactivate", async () => {
    const { service, prisma, tenantUsers, audit } = makeService();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: "m1",
      role: Role.ADMIN,
      status: MembershipStatus.Active,
    });
    tenantUsers.updateTenantUser.mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      username: null,
      name: "Admin",
      phone: null,
      role: Role.FINANCE,
      status: MembershipStatus.Suspended,
      membershipId: "m1",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    });

    await service.updateTenantUser(
      "t1",
      "u1",
      { role: Role.FINANCE, status: MembershipStatus.Suspended },
      actor,
    );

    const actions = audit.append.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toContain("PLATFORM_TENANT_USER_ROLE_CHANGED");
    expect(actions).toContain("PLATFORM_TENANT_USER_DEACTIVATED");
    expect(actions).toContain("PLATFORM_TENANT_USER_UPDATED");
  });

  it("password reset audits without password and scopes to tenant", async () => {
    const { service, tenantUsers, audit } = makeService();
    tenantUsers.resetTenantUserPassword.mockResolvedValue({ ok: true });

    await service.resetTenantUserPassword(
      "t1",
      "u1",
      "reset-secret-99",
      actor,
      "corr-2",
    );

    expect(tenantUsers.resetTenantUserPassword).toHaveBeenCalledWith(
      "t1",
      "u1",
      "reset-secret-99",
      { allowOfficeReset: true },
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLATFORM_TENANT_USER_PASSWORD_RESET",
        targetTenantId: "t1",
        entityId: "u1",
      }),
    );
    const meta = audit.append.mock.calls[0][0].metadata;
    expect(JSON.stringify(meta)).not.toContain("reset-secret-99");
  });

  it("create failure audits safely", async () => {
    const { service, tenantUsers, audit } = makeService();
    tenantUsers.createTenantUser.mockRejectedValue(
      new BadRequestException("Failed to create auth user"),
    );

    await expect(
      service.createTenantUser(
        "t1",
        {
          email: "a@example.com",
          name: "A",
          role: Role.ADMIN,
          password: "password1",
        } as any,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLATFORM_TENANT_USER_CREATE_FAILED",
        metadata: expect.not.objectContaining({ password: expect.anything() }),
      }),
    );
  });
});
