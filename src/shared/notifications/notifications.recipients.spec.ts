import { MembershipStatus, NotificationAudience, Role } from "@prisma/client";
import { resolveRecipientUserIds } from "./notifications.recipients";

describe("resolveRecipientUserIds", () => {
  const prisma = {
    tenantMembership: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns single user for USER audience", async () => {
    const ids = await resolveRecipientUserIds(prisma, {
      tenantId: "t1",
      audience: NotificationAudience.USER,
      userId: "driver-1",
      role: null,
    });
    expect(ids).toEqual(["driver-1"]);
    expect(prisma.tenantMembership.findMany).not.toHaveBeenCalled();
  });

  it("returns active memberships for ROLE audience", async () => {
    prisma.tenantMembership.findMany.mockResolvedValue([
      { userId: "ops-a" },
      { userId: "ops-b" },
    ]);

    const ids = await resolveRecipientUserIds(prisma, {
      tenantId: "t1",
      audience: NotificationAudience.ROLE,
      userId: null,
      role: Role.OPS,
    });

    expect(ids).toEqual(["ops-a", "ops-b"]);
    expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        role: Role.OPS,
        status: MembershipStatus.Active,
      },
      select: { userId: true },
    });
  });

  it("returns all ops roles for TENANT audience", async () => {
    prisma.tenantMembership.findMany.mockResolvedValue([
      { userId: "admin-a" },
      { userId: "finance-1" },
    ]);

    const ids = await resolveRecipientUserIds(prisma, {
      tenantId: "t1",
      audience: NotificationAudience.TENANT,
      userId: null,
      role: null,
    });

    expect(ids).toEqual(["admin-a", "finance-1"]);
    expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        role: { in: [Role.ADMIN, Role.OPS, Role.FINANCE] },
        status: MembershipStatus.Active,
      },
      select: { userId: true },
    });
  });
});
