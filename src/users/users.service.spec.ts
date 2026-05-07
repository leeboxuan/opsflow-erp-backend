import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  function makeService(overrides?: Partial<any>) {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://signed/avatar" }, error: null });
    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({
      createSignedUrl,
      upload,
      remove,
    });
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "u1",
          email: "admin@demo.com",
          name: "Admin",
          displayName: "Admin",
          role: "ADMIN",
          avatarKey: null,
          avatarUpdatedAt: null,
          createdAt: new Date("2026-05-08T00:00:00.000Z"),
          updatedAt: new Date("2026-05-08T00:00:00.000Z"),
        }),
        update: jest.fn().mockResolvedValue({
          id: "u1",
          email: "admin@demo.com",
          name: "Admin",
          displayName: "Admin Updated",
          role: "ADMIN",
          avatarKey: null,
          avatarUpdatedAt: null,
          createdAt: new Date("2026-05-08T00:00:00.000Z"),
          updatedAt: new Date("2026-05-08T00:00:00.000Z"),
        }),
      },
      drivers: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      jobDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      tripDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...overrides,
    };
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: { from },
      }),
    };
    return {
      service: new UsersService(prisma, supabaseService),
      prisma,
      from,
      createSignedUrl,
      upload,
      remove,
    };
  }

  it("GET /users/me returns authenticated profile", async () => {
    const { service } = makeService();
    const profile = await service.getMyProfile("t1", "u1");
    expect(profile).toMatchObject({
      id: "u1",
      email: "admin@demo.com",
      role: "ADMIN",
      tenantId: "t1",
    });
  });

  it("admin can access own profile like other roles", async () => {
    const { service } = makeService({
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "admin1",
          email: "admin@demo.com",
          name: "Admin",
          displayName: "Admin",
          role: "ADMIN",
          avatarKey: null,
          avatarUpdatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: jest.fn(),
      },
    });
    const profile = await service.getMyProfile("tenant-admin", "admin1");
    expect(profile.role).toBe("ADMIN");
  });

  it("PATCH /users/me updates displayName/name only", async () => {
    const { service, prisma } = makeService();
    await service.updateMyProfile("t1", "u1", Role.ADMIN, {
      displayName: "Nathalie Lee",
      name: "Nathalie",
    } as any);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("OPS/FINANCE can update own displayName", async () => {
    const { service, prisma } = makeService();
    await service.updateMyProfile("t1", "u1", Role.OPS, {
      displayName: "Ops Name",
    } as any);
    await service.updateMyProfile("t1", "u1", Role.FINANCE, {
      displayName: "Finance Name",
    } as any);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("PATCH /users/me cannot update email/role/tenantId", async () => {
    const { service, prisma } = makeService();
    await service.updateMyProfile("t1", "u1", Role.ADMIN, {
      displayName: "New Name",
      email: "hacker@demo.com",
      role: "SUPERADMIN",
      tenantId: "other",
    } as any);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          email: expect.anything(),
          role: expect.anything(),
          tenantId: expect.anything(),
        }),
      }),
    );
  });

  it("DRIVER cannot update own displayName/name/email", async () => {
    const { service } = makeService();
    await expect(
      service.updateMyProfile("t1", "u1", Role.DRIVER, {
        displayName: "Driver New",
        email: "driver@demo.com",
      } as any),
    ).rejects.toThrow("Drivers cannot update name or email from profile.");
  });

  it("name propagation updates denormalized metadata fields", async () => {
    const { service, prisma } = makeService();
    await service.updateUserDisplayNameAndPropagate({
      tenantId: "t1",
      userId: "u1",
      newName: "Renamed User",
      actorUserId: "u1",
    });
    expect(prisma.jobDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t1", uploadedByUserId: "u1" },
        data: { uploadedByNameSnapshot: "Renamed User" },
      }),
    );
    expect(prisma.tripDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t1", signedByUserId: "u1" },
        data: { signedByName: "Renamed User" },
      }),
    );
    expect(prisma.drivers.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t1", userId: "u1" },
      }),
    );
  });

  it("failed propagation rolls back user name update transaction", async () => {
    const { service, prisma } = makeService({
      tripDocument: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockRejectedValueOnce(new Error("propagation failed")),
      },
    });
    await expect(
      service.updateUserDisplayNameAndPropagate({
        tenantId: "t1",
        userId: "u1",
        newName: "Renamed User",
        actorUserId: "u1",
      }),
    ).rejects.toThrow("propagation failed");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("POST avatar rejects non-image", async () => {
    const { service } = makeService();
    await expect(
      service.uploadMyAvatar("t1", "u1", {
        mimetype: "application/pdf",
        size: 123,
        buffer: Buffer.from("x"),
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("POST avatar uploads image and updates avatarKey", async () => {
    const { service, prisma, upload } = makeService({
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "u1",
          email: "admin@demo.com",
          name: "Admin",
          displayName: "Admin",
          role: "ADMIN",
          avatarKey: "t1/users/u1/avatar.png",
          avatarUpdatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const res = await service.uploadMyAvatar("t1", "u1", {
      mimetype: "image/jpeg",
      size: 1024,
      buffer: Buffer.from("img"),
    } as any);
    expect(upload).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          avatarKey: "t1/users/u1/avatar.jpg",
        }),
      }),
    );
    expect(res.avatarKey).toBe("t1/users/u1/avatar.jpg");
  });

  it("DRIVER can upload and delete avatar", async () => {
    const { service, prisma } = makeService({
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "u1",
            email: "driver@demo.com",
            name: "Driver",
            displayName: "Driver",
            role: "DRIVER",
            avatarKey: null,
            avatarUpdatedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .mockResolvedValueOnce({
            id: "u1",
            email: "driver@demo.com",
            name: "Driver",
            displayName: "Driver",
            role: "DRIVER",
            avatarKey: "t1/users/u1/avatar.png",
            avatarUpdatedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        update: jest.fn().mockResolvedValue({
          id: "u1",
          email: "driver@demo.com",
          name: "Driver",
          displayName: "Driver",
          role: "DRIVER",
          avatarKey: null,
          avatarUpdatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    });
    await service.uploadMyAvatar("t1", "u1", {
      mimetype: "image/png",
      size: 128,
      buffer: Buffer.from("img"),
    } as any);
    await service.deleteMyAvatar("t1", "u1");
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("DELETE avatar clears avatar fields", async () => {
    const { service, prisma, remove } = makeService({
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: "u1",
          email: "admin@demo.com",
          name: "Admin",
          displayName: "Admin",
          role: "ADMIN",
          avatarKey: "t1/users/u1/avatar.jpg",
          avatarUpdatedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue({
          id: "u1",
          email: "admin@demo.com",
          name: "Admin",
          displayName: "Admin",
          role: "ADMIN",
          avatarKey: null,
          avatarUpdatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    });
    const profile = await service.deleteMyAvatar("t1", "u1");
    expect(remove).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          avatarKey: null,
          avatarUrl: null,
          avatarUpdatedAt: null,
        },
      }),
    );
    expect(profile.avatarKey).toBeNull();
  });

  it("tenant isolation enforced", async () => {
    const { service } = makeService({
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    });
    await expect(service.getMyProfile("tenant-a", "u1")).rejects.toThrow(
      NotFoundException,
    );
  });
});
