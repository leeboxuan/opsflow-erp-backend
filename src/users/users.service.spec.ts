import { BadRequestException, NotFoundException } from "@nestjs/common";
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
    await service.updateMyProfile("t1", "u1", {
      displayName: "Nathalie Lee",
      name: "Nathalie",
    } as any);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: "Nathalie Lee",
          name: "Nathalie",
        }),
      }),
    );
  });

  it("PATCH /users/me cannot update email/role/tenantId", async () => {
    const { service, prisma } = makeService();
    await service.updateMyProfile("t1", "u1", {
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
