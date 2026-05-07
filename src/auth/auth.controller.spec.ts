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
      user: { authUserId: "auth-u1", email: "admin@demo.com" },
      tenant: { tenantId: "t1" },
    } as any);

    expect(res.name).toBe("Nat Admin");
    expect(res.displayName).toBe("Nat Admin");
    expect(res.tenantMemberships).toEqual([
      {
        tenantId: "t1",
        role: "ADMIN",
        status: "Active",
        tenant: { id: "t1", name: "Tenant One" },
      },
    ]);
  });

  it("returns avatarUrl when avatarKey exists", async () => {
    const { controller, createSignedUrl } = makeController();
    const res = await controller.getMe({
      user: { authUserId: "auth-u1", email: "admin@demo.com" },
      tenant: { tenantId: "t1" },
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
      user: { authUserId: "auth-u1", email: "admin@demo.com" },
      tenant: { tenantId: "t1" },
    } as any);

    expect(res.avatarUrl).toBeNull();
    expect(res.avatarKey).toBeNull();
  });

  it("does not expose sensitive fields", async () => {
    const { controller } = makeController();
    const res = await controller.getMe({
      user: { authUserId: "auth-u1", email: "admin@demo.com" },
      tenant: { tenantId: "t1" },
    } as any);

    expect((res as any).passwordHash).toBeUndefined();
    expect((res as any).password).toBeUndefined();
  });
});
