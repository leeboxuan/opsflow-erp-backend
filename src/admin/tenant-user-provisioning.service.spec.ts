import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { MembershipStatus, Role, TenantStatus } from "@prisma/client";
import { TenantUserProvisioningService } from "./tenant-user-provisioning.service";

describe("TenantUserProvisioningService", () => {
  function makeService() {
    const prisma: any = {
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === "function") return arg(prisma);
        return Promise.all(arg);
      }),
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ slug: "acme" }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      tenantMembership: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      customer_companies: { upsert: jest.fn() },
      customer_contacts: { upsert: jest.fn() },
    };

    const deleteUser = jest.fn().mockResolvedValue({ error: null });
    const createUser = jest.fn().mockResolvedValue({
      data: { user: { id: "auth-new" } },
      error: null,
    });
    const updateUserById = jest.fn().mockResolvedValue({ error: null });
    const inviteUserByEmail = jest.fn().mockResolvedValue({ error: null });

    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        auth: {
          admin: {
            createUser,
            deleteUser,
            updateUserById,
            inviteUserByEmail,
          },
        },
      }),
    };

    const service = new TenantUserProvisioningService(prisma, supabaseService);
    return {
      service,
      prisma,
      createUser,
      deleteUser,
      updateUserById,
      inviteUserByEmail,
    };
  }

  it("creates office user with real email + password (platform mode), stores TRANSPORT_STAFF", async () => {
    const { service, prisma, createUser, inviteUserByEmail } = makeService();
    prisma.user.upsert.mockResolvedValue({
      id: "u1",
      email: "staff@example.com",
      username: null,
      name: "Staff",
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.tenantMembership.upsert.mockResolvedValue({
      id: "m1",
      role: Role.TRANSPORT_STAFF,
      status: MembershipStatus.Active,
    });

    const result = await service.createTenantUser(
      "t1",
      {
        email: "staff@example.com",
        name: "Staff",
        role: Role.TRANSPORT_STAFF,
        password: "password1",
      },
      { mode: "platform-admin" },
    );

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "staff@example.com",
        password: "password1",
        email_confirm: true,
      }),
    );
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(prisma.tenantMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: Role.TRANSPORT_STAFF }),
      }),
    );
    expect(result.email).toBe("staff@example.com");
    expect(result.role).toBe(Role.TRANSPORT_STAFF);
    expect(JSON.stringify(result)).not.toContain("password1");
  });

  it("creates warehouse user with username and hides synthetic email", async () => {
    const { service, prisma, createUser } = makeService();
    prisma.user.upsert.mockResolvedValue({
      id: "u-wh",
      email: "acme.floor1@auth.opsflow.app",
      username: "floor1",
      name: "Floor",
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.tenantMembership.upsert.mockResolvedValue({
      id: "m-wh",
      role: Role.WAREHOUSE,
      status: MembershipStatus.Active,
    });

    const result = await service.createTenantUser(
      "t1",
      {
        username: "floor1",
        name: "Floor",
        role: Role.WAREHOUSE,
        password: "password1",
      },
      { mode: "platform-admin" },
    );

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "acme.floor1@auth.opsflow.app",
      }),
    );
    expect(result.email).toBeNull();
    expect(result.username).toBe("floor1");
    expect(JSON.stringify(result)).not.toContain("auth.opsflow.app");
    expect(JSON.stringify(result)).not.toContain("password1");
  });

  it("rejects DRIVER on create", async () => {
    const { service } = makeService();
    await expect(
      service.createTenantUser(
        "t1",
        {
          email: "d@example.com",
          name: "Driver",
          role: Role.DRIVER,
          password: "password1",
        },
        { mode: "platform-admin" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects creating OPS", async () => {
    const { service } = makeService();
    await expect(
      service.createTenantUser(
        "t1",
        {
          email: "ops@example.com",
          name: "Ops",
          role: Role.OPS,
          password: "password1",
        },
        { mode: "platform-admin" },
      ),
    ).rejects.toThrow(/TRANSPORT_STAFF/);
  });

  it("compensates newly created auth identity when Prisma fails", async () => {
    const { service, prisma, createUser, deleteUser } = makeService();
    prisma.$transaction.mockRejectedValue(new Error("db down"));

    await expect(
      service.createTenantUser(
        "t1",
        {
          email: "new@example.com",
          name: "New",
          role: Role.ADMIN,
          password: "password1",
        },
        { mode: "platform-admin" },
      ),
    ).rejects.toThrow("db down");

    expect(createUser).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("auth-new");
  });

  it("does not compensate when auth identity was pre-existing", async () => {
    const { service, prisma, createUser, deleteUser } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u-existing",
      authUserId: "auth-pre",
      email: "existing@example.com",
      username: null,
      name: "Existing",
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.tenantMembership.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(new Error("db down"));

    await expect(
      service.createTenantUser(
        "t1",
        {
          email: "existing@example.com",
          name: "Existing",
          role: Role.ADMIN,
          password: "password1",
        },
        { mode: "platform-admin" },
      ),
    ).rejects.toThrow("db down");

    expect(createUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("idempotent retry returns existing membership without creating duplicate", async () => {
    const { service, prisma, createUser } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      authUserId: "auth-1",
      email: "staff@example.com",
    });
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: "m1",
      role: Role.ADMIN,
      status: MembershipStatus.Active,
      user: {
        id: "u1",
        email: "staff@example.com",
        username: null,
        name: "Staff",
        phone: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const result = await service.createTenantUser(
      "t1",
      {
        email: "staff@example.com",
        name: "Staff",
        role: Role.ADMIN,
        password: "password1",
      },
      { mode: "platform-admin" },
    );

    expect(createUser).not.toHaveBeenCalled();
    expect(result.id).toBe("u1");
    expect(result.membershipId).toBe("m1");
  });

  it("multi-tenant: adding membership does not touch other tenants", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u-shared",
      authUserId: "auth-shared",
      email: "shared@example.com",
      username: null,
      name: "Shared",
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // No membership in THIS tenant
    prisma.tenantMembership.findUnique.mockResolvedValue(null);
    prisma.user.upsert.mockResolvedValue({
      id: "u-shared",
      email: "shared@example.com",
      username: null,
      name: "Shared",
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.tenantMembership.upsert.mockResolvedValue({
      id: "m-t2",
      role: Role.FINANCE,
      status: MembershipStatus.Active,
    });

    await service.createTenantUser(
      "t2",
      {
        email: "shared@example.com",
        name: "Shared",
        role: Role.FINANCE,
        password: "password1",
      },
      { mode: "platform-admin" },
    );

    expect(prisma.tenantMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_userId: { tenantId: "t2", userId: "u-shared" } },
      }),
    );
  });

  it("rejects username edit when allowUsernameEdit is false", async () => {
    const { service, prisma } = makeService();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: "m-wh",
      role: Role.WAREHOUSE,
      status: MembershipStatus.Active,
      user: {
        id: "u-wh",
        email: "acme.floor1@auth.opsflow.app",
        username: "floor1",
        name: "Floor",
        phone: null,
      },
    });

    await expect(
      service.updateTenantUser(
        "t1",
        "u-wh",
        { username: "floor2" },
        { allowUsernameEdit: false },
      ),
    ).rejects.toThrow(/Username cannot be changed/);
  });

  it("platform password reset works for office users", async () => {
    const { service, prisma, updateUserById } = makeService();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: "m1",
      role: Role.ADMIN,
      status: MembershipStatus.Active,
      user: {
        id: "u1",
        email: "admin@example.com",
        username: null,
        authUserId: "auth-1",
      },
    });

    const result = await service.resetTenantUserPassword(
      "t1",
      "u1",
      "newpass12",
      { allowOfficeReset: true },
    );

    expect(result).toEqual({ ok: true });
    expect(updateUserById).toHaveBeenCalledWith("auth-1", {
      password: "newpass12",
    });
  });

  it("tenant-admin password reset rejects office users", async () => {
    const { service, prisma } = makeService();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: "m1",
      role: Role.ADMIN,
      status: MembershipStatus.Active,
      user: {
        id: "u1",
        email: "admin@example.com",
        username: null,
        authUserId: "auth-1",
      },
    });

    await expect(
      service.resetTenantUserPassword("t1", "u1", "newpass12", {
        allowOfficeReset: false,
      }),
    ).rejects.toThrow(/username\/password operational users/);
  });

  it("password validation errors do not echo the password", async () => {
    const { service } = makeService();
    try {
      await service.createTenantUser(
        "t1",
        {
          email: "x@example.com",
          name: "X",
          role: Role.ADMIN,
          password: "short",
        },
        { mode: "platform-admin" },
      );
      fail("expected throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(String(e.message)).not.toContain("short");
      expect(JSON.stringify(e)).not.toContain("short");
    }
  });

  it("rejects duplicate username in tenant", async () => {
    const { service, prisma } = makeService();
    prisma.tenantMembership.findFirst.mockResolvedValue({ id: "m-clash" });

    await expect(
      service.createTenantUser(
        "t1",
        {
          username: "floor1",
          name: "Floor",
          role: Role.WAREHOUSE,
          password: "password1",
        },
        { mode: "platform-admin" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("deactivate updates membership status only", async () => {
    const { service, prisma } = makeService();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: "m1",
      role: Role.ADMIN,
      status: MembershipStatus.Active,
      user: {
        id: "u1",
        email: "a@example.com",
        username: null,
        name: "A",
        phone: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    prisma.user.update.mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      username: null,
      name: "A",
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.tenantMembership.update.mockResolvedValue({
      id: "m1",
      role: Role.ADMIN,
      status: MembershipStatus.Suspended,
    });

    const result = await service.updateTenantUser(
      "t1",
      "u1",
      { status: MembershipStatus.Suspended },
      { allowUsernameEdit: false },
    );

    expect(result.status).toBe(MembershipStatus.Suspended);
    expect(prisma.tenantMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m1" },
        data: { status: MembershipStatus.Suspended },
      }),
    );
  });

  it("reset rejects when membership not in tenant", async () => {
    const { service, prisma } = makeService();
    prisma.tenantMembership.findUnique.mockResolvedValue(null);
    await expect(
      service.resetTenantUserPassword("t1", "u-missing", "password1", {
        allowOfficeReset: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
