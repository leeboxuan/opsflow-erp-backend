import { AuthController } from "./auth.controller";

describe("AuthController getMe", () => {
  function makeController(overrides?: Partial<any>) {
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "https://signed/avatar" },
      error: null,
    });
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl,
          }),
        },
      }),
    };
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "u1",
          email: "admin@demo.com",
          name: "Nat Admin",
          displayName: "Nat Admin",
          role: "USER",
          authUserId: "auth-u1",
          avatarKey: "t1/users/u1/avatar.jpg",
          avatarUpdatedAt: new Date("2026-05-08T00:00:00.000Z"),
          passwordHash: "secret",
        }),
        update: jest.fn().mockImplementation(async (args: any) => ({
          id: "u1",
          email: "admin@demo.com",
          name: "Nat Admin",
          displayName: "Nat Admin",
          role: "USER",
          authUserId: "auth-u1",
          avatarKey: "t1/users/u1/avatar.jpg",
          avatarUpdatedAt: new Date("2026-05-08T00:00:00.000Z"),
          ...args.data,
        })),
      },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: "t1",
            role: "ADMIN",
            status: "Active",
            tenant: {
              id: "t1",
              name: "Tenant One",
              status: "ACTIVE",
              timezone: "Pacific/Auckland",
            },
            createdAt: new Date("2026-05-08T00:00:00.000Z"),
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          id: "m1",
          status: "Active",
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      ...overrides,
    };
    const controller = new AuthController(
      {} as any,
      supabaseService,
      prisma,
      { get: jest.fn() } as any,
    );
    return { controller, prisma, createSignedUrl };
  }

  it("returns name/displayName and tenantMemberships", async () => {
    const { controller } = makeController();
    const res = await controller.getMe({
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.name).toBe("Nat Admin");
    expect(res.displayName).toBe("Nat Admin");
    expect(res.tenantMemberships).toEqual([
      {
        tenantId: "t1",
        role: "ADMIN",
        roles: ["TENANT_ADMIN"],
        status: "Active",
        tenant: {
          id: "t1",
          name: "Tenant One",
          status: "ACTIVE",
          timezone: "Pacific/Auckland",
          modules: [],
        },
      },
    ]);
    expect(res.tenantId).toBeUndefined();
    expect(res.roles).toEqual([]);
  });

  it("returns WAREHOUSE tenant membership in getMe", async () => {
    const { controller } = makeController({
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: "t1",
            role: "WAREHOUSE",
            status: "Active",
            tenant: { id: "t1", name: "Tenant One" },
            createdAt: new Date("2026-05-08T00:00:00.000Z"),
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          id: "m1",
          status: "Active",
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const res = await controller.getMe({
      user: { sub: "auth-u1", email: "warehouse@example.com" },
    } as any);

    expect(res.tenantMemberships).toEqual([
      expect.objectContaining({
        role: "WAREHOUSE",
        roles: ["WAREHOUSE_STAFF"],
        status: "Active",
      }),
    ]);
  });

  it("returns avatarUrl when avatarKey exists", async () => {
    const { controller, createSignedUrl } = makeController();
    const res = await controller.getMe({
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(createSignedUrl).toHaveBeenCalledWith("t1/users/u1/avatar.jpg", 3600);
    expect(res.avatarUrl).toBe("https://signed/avatar");
    expect(res.avatarKey).toBe("t1/users/u1/avatar.jpg");
  });

  it("returns avatarUrl null when no avatarKey", async () => {
    const { controller } = makeController({
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "u1",
          email: "admin@demo.com",
          name: "Nat Admin",
          displayName: "Nat Admin",
          role: "USER",
          authUserId: "auth-u1",
          avatarKey: null,
          avatarUpdatedAt: null,
        }),
        update: jest.fn(),
      },
    });
    const res = await controller.getMe({
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.avatarUrl).toBeNull();
    expect(res.avatarKey).toBeNull();
  });

  it("does not expose sensitive fields", async () => {
    const { controller } = makeController();
    const res = await controller.getMe({
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect((res as any).passwordHash).toBeUndefined();
    expect((res as any).password).toBeUndefined();
  });

  it("does not require tenant context for auth bootstrap", async () => {
    const { controller } = makeController();
    const res = await controller.getMe({
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);
    expect(res.tenantId).toBeUndefined();
    expect(Array.isArray(res.tenantMemberships)).toBe(true);
    expect(res.activeTenantTimezone).toBeNull();
  });

  it("returns only the active ordinary member tenant timezone", async () => {
    const { controller, prisma } = makeController();
    const res = await controller.getMe({
      headers: { "x-tenant-id": "t1" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.activeTenantTimezone).toBe("Pacific/Auckland");
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("does not leak a foreign tenant timezone to an ordinary user", async () => {
    const { controller, prisma } = makeController({
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: "America/New_York",
          status: "ACTIVE",
        }),
      },
    });
    const res = await controller.getMe({
      headers: { "x-tenant-id": "foreign-tenant" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.activeTenantTimezone).toBeNull();
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("returns the operated tenant timezone for an active Platform Admin", async () => {
    const { controller, prisma } = makeController({
      platformAdmin: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "pa-1", status: "ACTIVE" }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: "America/New_York",
          status: "ACTIVE",
        }),
      },
    });
    const res = await controller.getMe({
      headers: { "x-tenant-id": "operated-tenant" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.activeTenantTimezone).toBe("America/New_York");
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: "operated-tenant" },
      select: { timezone: true, status: true },
    });
  });

  it("falls back safely for an invalid active tenant timezone", async () => {
    const { controller } = makeController({
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: "t1",
            role: "ADMIN",
            status: "Active",
            tenant: {
              id: "t1",
              name: "Tenant One",
              status: "ACTIVE",
              timezone: "Not/AZone",
            },
          },
        ]),
      },
    });
    const res = await controller.getMe({
      headers: { "x-tenant-id": "t1" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.activeTenantTimezone).toBe("Asia/Singapore");
  });

  it("returns tenantId from a matching x-tenant-id membership", async () => {
    const { controller } = makeController();
    const res = await controller.getMe({
      headers: { "x-tenant-id": "t1" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.tenantId).toBe("t1");
    expect(res.roles).toEqual(["TENANT_ADMIN"]);
  });

  it("omits inactive memberships and inaccessible tenants from getMe", async () => {
    const { controller } = makeController({
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: "inactive",
            role: "ADMIN",
            status: "Suspended",
            tenant: { id: "inactive", name: "Inactive", status: "ACTIVE" },
          },
          {
            tenantId: "suspended-tenant",
            role: "ADMIN",
            status: "Active",
            tenant: { id: "suspended-tenant", name: "Suspended Co", status: "SUSPENDED" },
          },
          {
            tenantId: "archived-tenant",
            role: "ADMIN",
            status: "Active",
            tenant: { id: "archived-tenant", name: "Archived Co", status: "ARCHIVED" },
          },
          {
            tenantId: "t1",
            role: "ADMIN",
            status: "Active",
            tenant: { id: "t1", name: "Tenant One", status: "ACTIVE", timezone: "Pacific/Auckland" },
          },
        ]),
      },
    });

    const res = await controller.getMe({
      headers: { "x-tenant-id": "t1" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.tenantMemberships.map((m: { tenantId: string }) => m.tenantId)).toEqual(["t1"]);
    expect(res.tenantId).toBe("t1");

    const stale = await controller.getMe({
      headers: { "x-tenant-id": "inactive" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);
    expect(stale.tenantId).toBeUndefined();
  });

  it("returns tenantId for a valid Platform Admin operated tenant without inventing a membership", async () => {
    const { controller, prisma } = makeController({
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue({ id: "pa-1", status: "ACTIVE" }),
      },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: "operated-tenant",
          timezone: "America/New_York",
          status: "ACTIVE",
        }),
      },
    });
    const res = await controller.getMe({
      headers: { "x-tenant-id": "operated-tenant" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);

    expect(res.tenantId).toBe("operated-tenant");
    expect(res.tenantMemberships).toEqual([]);
    expect(prisma.tenant.findUnique).toHaveBeenCalled();
  });

  it("does not silently select another membership when x-tenant-id is absent or unmatched", async () => {
    const { controller } = makeController({
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: "t1",
            role: "ADMIN",
            status: "Active",
            tenant: {
              id: "t1",
              name: "Tenant One",
              status: "ACTIVE",
              timezone: "Pacific/Auckland",
            },
          },
          {
            tenantId: "t2",
            role: "ADMIN",
            status: "Active",
            tenant: {
              id: "t2",
              name: "Tenant Two",
              status: "ACTIVE",
              timezone: "Asia/Singapore",
            },
          },
        ]),
      },
    });

    const withoutHeader = await controller.getMe({
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);
    expect(withoutHeader.tenantId).toBeUndefined();
    expect(withoutHeader.roles).toEqual([]);

    const unmatched = await controller.getMe({
      headers: { "x-tenant-id": "unknown-tenant" },
      user: { sub: "auth-u1", email: "admin@demo.com" },
    } as any);
    expect(unmatched.tenantId).toBeUndefined();
    expect(unmatched.roles).toEqual([]);
  });
});
