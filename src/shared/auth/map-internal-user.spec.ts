import {
  jwtEmailFromPayload,
  mapSupabaseSubjectToInternalUser,
} from "./map-internal-user";

function mockUserDelegate(overrides?: {
  byAuth?: unknown;
  byEmail?: unknown;
}) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const user = {
    findFirst: jest.fn(async ({ where }: { where: { authUserId?: string; email?: string } }) => {
      if (where.authUserId) return overrides?.byAuth ?? null;
      if (where.email) return overrides?.byEmail ?? null;
      return null;
    }),
    create: jest.fn(async ({ data }: { data: unknown }) => {
      created.push(data);
      return { id: "new-user", ...(data as object) };
    }),
    update: jest.fn(async ({ data, where }: { data: unknown; where: { id: string } }) => {
      updated.push({ data, where });
      return { id: where.id, ...(data as object) };
    }),
    created,
    updated,
  };
  return user;
}

describe("mapSupabaseSubjectToInternalUser", () => {
  const authUserId = "11ed325c-8b25-4fd0-a040-6b4a4a238753";

  it("maps bootstrap PlatformAdmin by authUserId even with zero memberships and no JWT email", async () => {
    const existing = {
      id: "cms-user-1",
      email: "owner@example.com",
      authUserId,
      role: "SUPERADMIN",
    };
    const prisma = { user: mockUserDelegate({ byAuth: existing }) };
    const mapped = await mapSupabaseSubjectToInternalUser(prisma, {
      authUserId,
      email: null,
    });
    expect(mapped).toEqual(existing);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { authUserId },
    });
  });

  it("matches Supabase UID to User.authUserId exactly", async () => {
    const prisma = {
      user: mockUserDelegate({
        byAuth: {
          id: "u1",
          email: "a@b.com",
          authUserId,
          role: "USER",
        },
      }),
    };
    const mapped = await mapSupabaseSubjectToInternalUser(prisma, {
      authUserId,
      email: "a@b.com",
    });
    expect(mapped?.id).toBe("u1");
    expect(mapped?.authUserId).toBe(authUserId);
    expect(prisma.user.findFirst.mock.calls[0][0]).toEqual({
      where: { authUserId },
    });
  });

  it("creates a tenant user on first login when no internal User exists", async () => {
    const prisma = { user: mockUserDelegate() };
    const mapped = await mapSupabaseSubjectToInternalUser(prisma, {
      authUserId,
      email: "staff@tenant.com",
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        authUserId,
        email: "staff@tenant.com",
        name: "staff@tenant.com",
        role: "USER",
      },
    });
    expect(mapped?.id).toBe("new-user");
  });

  it("fails closed when Auth user has no internal User and JWT has no email", async () => {
    const prisma = { user: mockUserDelegate() };
    const mapped = await mapSupabaseSubjectToInternalUser(prisma, {
      authUserId,
      email: null,
    });
    expect(mapped).toBeNull();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("backfills authUserId on legacy email-matched rows", async () => {
    const prisma = {
      user: mockUserDelegate({
        byEmail: {
          id: "legacy",
          email: "legacy@tenant.com",
          authUserId: null,
          role: "USER",
        },
      }),
    };
    await mapSupabaseSubjectToInternalUser(prisma, {
      authUserId,
      email: "legacy@tenant.com",
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "legacy" },
      data: { authUserId },
    });
  });
});

describe("jwtEmailFromPayload", () => {
  it("reads email claim then user_metadata.email", () => {
    expect(jwtEmailFromPayload({ email: "a@b.com" })).toBe("a@b.com");
    expect(
      jwtEmailFromPayload({ user_metadata: { email: "m@b.com" } }),
    ).toBe("m@b.com");
    expect(jwtEmailFromPayload({})).toBeNull();
  });
});
