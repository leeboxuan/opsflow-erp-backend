import {
  ConflictException,
  ForbiddenException,
  GoneException,
  UnauthorizedException,
} from "@nestjs/common";
import { PlatformAdminStatus, UserRole } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { PlatformBootstrapService } from "./platform-bootstrap.service";
import { PlatformBootstrapController } from "./platform-bootstrap.controller";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(),
}));

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe("PlatformBootstrapService", () => {
  const ownerEmail = "owner@opsflow.io";
  const bootstrapToken = "test-bootstrap-token";

  function makeService(overrides?: {
    ownerEmail?: string | undefined;
    bootstrapToken?: string | undefined;
  }) {
    const prisma: any = {
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === "function") return arg(prisma);
        return Promise.all(arg);
      }),
      platformAdmin: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "pa-1",
          status: PlatformAdminStatus.ACTIVE,
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "u-1",
          email: ownerEmail,
          name: "Owner",
          authUserId: "auth-1",
          role: UserRole.USER,
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: "u-1",
          email: ownerEmail,
          name: "Owner",
          authUserId: "auth-1",
          role: data.role ?? UserRole.USER,
        })),
      },
      tenantMembership: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const audit = {
      appendInTx: jest.fn().mockResolvedValue(undefined),
      append: jest.fn(),
    };

    const createUser = jest.fn().mockResolvedValue({
      data: { user: { id: "auth-1" } },
      error: null,
    });
    const deleteUser = jest.fn().mockResolvedValue({ error: null });

    const supabaseService = {
      getClient: jest.fn().mockReturnValue({
        auth: { admin: { createUser, deleteUser } },
      }),
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === "PLATFORM_OWNER_EMAIL") {
          return overrides && "ownerEmail" in overrides
            ? overrides.ownerEmail
            : ownerEmail;
        }
        if (key === "PLATFORM_BOOTSTRAP_TOKEN") {
          return overrides && "bootstrapToken" in overrides
            ? overrides.bootstrapToken
            : bootstrapToken;
        }
        if (key === "SUPABASE_PROJECT_URL") return "https://example.supabase.co";
        if (key === "SUPABASE_ANON_KEY") return "anon-key";
        return undefined;
      }),
    };

    const signInWithPassword = jest.fn().mockResolvedValue({
      data: { user: { id: "auth-1" } },
      error: null,
    });
    mockedCreateClient.mockReturnValue({
      auth: { signInWithPassword },
    } as any);

    const service = new PlatformBootstrapService(
      prisma,
      audit as any,
      supabaseService as any,
      configService as any,
    );

    return {
      service,
      prisma,
      audit,
      createUser,
      deleteUser,
      signInWithPassword,
    };
  }

  beforeEach(() => {
    mockedCreateClient.mockReset();
  });

  it("status is available only when table is empty and owner email is set", async () => {
    const { service, prisma } = makeService();
    prisma.platformAdmin.count.mockResolvedValue(0);
    await expect(service.getStatus()).resolves.toEqual({ available: true });

    prisma.platformAdmin.count.mockResolvedValue(1);
    await expect(service.getStatus()).resolves.toEqual({ available: false });

    const unsetEmail = makeService({ ownerEmail: "" });
    unsetEmail.prisma.platformAdmin.count.mockResolvedValue(0);
    await expect(unsetEmail.service.getStatus()).resolves.toEqual({
      available: false,
    });
    expect(unsetEmail.prisma.platformAdmin.count).not.toHaveBeenCalled();

    const unsetToken = makeService({ bootstrapToken: "" });
    unsetToken.prisma.platformAdmin.count.mockResolvedValue(0);
    await expect(unsetToken.service.getStatus()).resolves.toEqual({
      available: false,
    });
    expect(unsetToken.prisma.platformAdmin.count).not.toHaveBeenCalled();
  });

  it("setup creates Auth+User+PlatformAdmin with no TenantMembership", async () => {
    const { service, prisma, audit, createUser } = makeService();

    const result = await service.setup({
      email: "Owner@Opsflow.io",
      password: "password12",
      name: "Owner",
      bootstrapToken,
    });

    expect(result.ok).toBe(true);
    expect(result.platformAdmin.id).toBe("pa-1");
    expect(createUser).toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: ownerEmail,
          role: UserRole.USER,
        }),
      }),
    );
    expect(prisma.platformAdmin.create).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: UserRole.SUPERADMIN },
      }),
    );
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
    expect(audit.appendInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: "PLATFORM_ADMIN_BOOTSTRAP",
        actorPlatformAdminId: "pa-1",
      }),
    );
  });

  it("setup rejects wrong email, missing token env, wrong token, and existing PA", async () => {
    const wrongEmail = makeService();
    await expect(
      wrongEmail.service.setup({
        email: "other@example.com",
        password: "password12",
        name: "Other",
        bootstrapToken,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const noToken = makeService({ bootstrapToken: "" });
    await expect(
      noToken.service.setup({
        email: ownerEmail,
        password: "password12",
        name: "Owner",
        bootstrapToken: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const noOwner = makeService({ ownerEmail: undefined });
    await expect(
      noOwner.service.setup({
        email: ownerEmail,
        password: "password12",
        name: "Owner",
        bootstrapToken,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const badToken = makeService();
    await expect(
      badToken.service.setup({
        email: ownerEmail,
        password: "password12",
        name: "Owner",
        bootstrapToken: "nope",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const exists = makeService();
    exists.prisma.platformAdmin.count.mockResolvedValue(1);
    await expect(
      exists.service.setup({
        email: ownerEmail,
        password: "password12",
        name: "Owner",
        bootstrapToken,
      }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it("setup verifies password when Auth user already exists", async () => {
    const { service, prisma, createUser, signInWithPassword } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: ownerEmail,
      name: "Owner",
      authUserId: "auth-existing",
      role: UserRole.USER,
    });

    await service.setup({
      email: ownerEmail,
      password: "password12",
      name: "Owner",
      bootstrapToken,
    });

    expect(createUser).not.toHaveBeenCalled();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: ownerEmail,
      password: "password12",
    });
  });

  it("claim promotes authenticated matching user and rejects others", async () => {
    const { service, prisma, audit } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: ownerEmail,
      name: "Owner",
      authUserId: "auth-1",
      role: UserRole.USER,
    });

    const result = await service.claim({
      userId: "u-1",
      email: ownerEmail,
    });
    expect(result.ok).toBe(true);
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
    expect(audit.appendInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: "PLATFORM_ADMIN_CLAIM",
        metadata: expect.objectContaining({
          dualIdentity: false,
          existingMembershipCount: 0,
        }),
      }),
    );
    expect(result.dualIdentity).toBe(false);

    await expect(
      service.claim({ userId: "u-2", email: "tenant@acme.com" }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.platformAdmin.count.mockResolvedValue(1);
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: ownerEmail,
      name: "Owner",
      authUserId: "auth-1",
      role: UserRole.USER,
    });
    await expect(
      service.claim({ userId: "u-1", email: ownerEmail }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it("claim fails closed when bootstrap token env is missing", async () => {
    const { service, prisma } = makeService({ bootstrapToken: "" });
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: ownerEmail,
      name: "Owner",
      authUserId: "auth-1",
      role: UserRole.USER,
    });
    await expect(
      service.claim({ userId: "u-1", email: ownerEmail }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("claim keeps existing tenant memberships as dual identity", async () => {
    const { service, prisma, audit } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: ownerEmail,
      name: "Owner",
      authUserId: "auth-1",
      role: UserRole.USER,
    });
    prisma.tenantMembership.count.mockResolvedValue(2);

    const result = await service.claim({
      userId: "u-1",
      email: ownerEmail,
    });

    expect(result.dualIdentity).toBe(true);
    expect(result.existingMembershipCount).toBe(2);
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
    expect(prisma.tenantMembership.delete).not.toHaveBeenCalled();
    expect(prisma.tenantMembership.deleteMany).not.toHaveBeenCalled();
    expect(audit.appendInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        metadata: expect.objectContaining({
          dualIdentity: true,
          existingMembershipCount: 2,
        }),
      }),
    );
  });

  it("claim rejects when Prisma user email does not match owner", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: "other@example.com",
      name: "Other",
      authUserId: "auth-1",
      role: UserRole.USER,
    });
    await expect(
      service.claim({ userId: "u-1", email: ownerEmail }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("compensates a newly created Auth user when Prisma promote fails", async () => {
    const { service, prisma, createUser, deleteUser } = makeService();
    prisma.$transaction.mockRejectedValue(new Error("db down"));

    await expect(
      service.setup({
        email: ownerEmail,
        password: "password12",
        name: "Owner",
        bootstrapToken,
      }),
    ).rejects.toThrow("db down");

    expect(createUser).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("auth-1");
  });

  it("retries setup against a leftover Auth user by verifying password", async () => {
    const { service, createUser, signInWithPassword } = makeService();
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "A user with this email address has already been registered" },
    });

    await service.setup({
      email: ownerEmail,
      password: "password12",
      name: "Owner",
      bootstrapToken,
    });

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: ownerEmail,
      password: "password12",
    });
  });

  it("claim rejects when a PlatformAdmin row already exists for the user", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: ownerEmail,
      name: "Owner",
      authUserId: "auth-1",
      role: UserRole.USER,
    });
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-existing",
      status: PlatformAdminStatus.ACTIVE,
    });

    await expect(
      service.claim({ userId: "u-1", email: ownerEmail }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("PlatformBootstrapController guards", () => {
  it("does not apply AuthGuard or PlatformAdminGuard at class level", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformBootstrapController,
    );
    expect(guards ?? []).toEqual([]);
  });

  it("applies AuthGuard only on claim", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformBootstrapController.prototype.claim,
    );
    expect(guards).toEqual([AuthGuard]);
  });

  it("is mounted at platform/bootstrap", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, PlatformBootstrapController),
    ).toBe("platform/bootstrap");
  });
});
