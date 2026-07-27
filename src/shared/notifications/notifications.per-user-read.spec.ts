import { NotificationAudience, Role } from "@prisma/client";
import { NotificationsService } from "./notifications.service";

describe("NotificationsService per-user read state", () => {
  const publish = jest.fn();
  const prisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    notificationRecipient: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    tenantMembership: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  };

  let svc: NotificationsService;

  const adminA = {
    tenantId: "tenant-1",
    userId: "admin-a",
    role: Role.ADMIN,
  };
  const adminB = {
    tenantId: "tenant-1",
    userId: "admin-b",
    role: Role.ADMIN,
  };
  const opsA = {
    tenantId: "tenant-1",
    userId: "ops-a",
    role: Role.TRANSPORT_STAFF,
  };
  const opsB = {
    tenantId: "tenant-1",
    userId: "ops-b",
    role: Role.TRANSPORT_STAFF,
  };
  const driver = {
    tenantId: "tenant-1",
    userId: "driver-1",
    role: Role.DRIVER,
  };

  const tenantNotification = {
    id: "notif-tenant-1",
    tenantId: "tenant-1",
    userId: null,
    role: null,
    audience: NotificationAudience.TENANT,
    type: "job.created",
    title: "New job created",
    description: "Job abc",
    severity: "INFO",
    entityType: "job",
    entityId: "job-1",
    jobId: "job-1",
    tripId: null,
    driverUserId: null,
    createdAt: new Date("2026-05-22T10:00:00.000Z"),
    metadata: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new NotificationsService(prisma as any, { publish } as any);
    svc.resetDedupeCache();
  });

  it("fan-out TENANT notification recipients for each ops admin user", async () => {
    prisma.tenantMembership.findMany.mockResolvedValue([
      { userId: "admin-a" },
      { userId: "admin-b" },
      { userId: "ops-a" },
    ]);
    prisma.notification.create.mockResolvedValue({
      ...tenantNotification,
      id: "n-new",
    });
    prisma.notificationRecipient.createMany.mockResolvedValue({ count: 3 });

    await svc.createFromRealtimeEvent({
      type: "job.created",
      tenantId: "tenant-1",
      entityType: "job",
      entityId: "job-1",
      jobId: "job-1",
      changedAt: new Date().toISOString(),
    });

    expect(prisma.notificationRecipient.createMany).toHaveBeenCalledWith({
      data: [
        { notificationId: "n-new", tenantId: "tenant-1", userId: "admin-a" },
        { notificationId: "n-new", tenantId: "tenant-1", userId: "admin-b" },
        { notificationId: "n-new", tenantId: "tenant-1", userId: "ops-a" },
      ],
      skipDuplicates: true,
    });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ readAt: expect.anything() }),
      }),
    );
  });

  it("Admin A markRead updates only Admin A recipient row", async () => {
    prisma.notification.findFirst.mockResolvedValue(tenantNotification);
    prisma.notificationRecipient.upsert.mockResolvedValue({
      id: "rec-a",
      notificationId: tenantNotification.id,
      tenantId: "tenant-1",
      userId: "admin-a",
      readAt: new Date("2026-05-22T11:00:00.000Z"),
      createdAt: new Date(),
    });

    const dto = await svc.markRead(adminA, tenantNotification.id);

    expect(prisma.notificationRecipient.upsert).toHaveBeenCalledWith({
      where: {
        notificationId_userId: {
          notificationId: tenantNotification.id,
          userId: "admin-a",
        },
      },
      create: expect.objectContaining({
        userId: "admin-a",
        readAt: expect.any(Date),
      }),
      update: { readAt: expect.any(Date) },
    });
    expect(dto.read).toBe(true);
    expect(dto.readAt).toBeTruthy();
  });

  it("Admin B still has unread after Admin A marks TENANT notification read", async () => {
    prisma.notificationRecipient.count.mockImplementation(async ({ where }: any) => {
      if (where.userId === "admin-a") return 0;
      if (where.userId === "admin-b") return 1;
      return 0;
    });

    const unreadA = await svc.unreadCount(adminA);
    const unreadB = await svc.unreadCount(adminB);

    expect(unreadA).toBe(0);
    expect(unreadB).toBe(1);
    expect(prisma.notificationRecipient.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: "admin-b",
        readAt: null,
      }),
    });
  });

  it("Ops A markRead does not mark read for Ops B on ROLE notification", async () => {
    const roleNotification = {
      ...tenantNotification,
      id: "notif-role-ops",
      audience: NotificationAudience.ROLE,
      role: Role.TRANSPORT_STAFF,
    };
    prisma.notification.findFirst.mockResolvedValue(roleNotification);
    prisma.notificationRecipient.upsert.mockResolvedValue({
      id: "rec-ops-a",
      notificationId: roleNotification.id,
      tenantId: "tenant-1",
      userId: "ops-a",
      readAt: new Date(),
      createdAt: new Date(),
    });

    await svc.markRead(opsA, roleNotification.id);

    expect(prisma.notificationRecipient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          notificationId_userId: {
            notificationId: roleNotification.id,
            userId: "ops-a",
          },
        },
      }),
    );
    expect(prisma.notificationRecipient.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          notificationId_userId: {
            userId: "ops-b",
          },
        },
      }),
    );
  });

  it("markAllRead affects only the current user recipient rows", async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: "n-1" },
      { id: "n-2" },
    ]);
    prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 2 });
    prisma.notificationRecipient.findMany.mockResolvedValue([
      { notificationId: "n-1" },
      { notificationId: "n-2" },
    ]);

    const marked = await svc.markAllRead(adminA);

    expect(marked).toBe(2);
    expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: "admin-a",
        readAt: null,
        notificationId: { in: ["n-1", "n-2"] },
      }),
      data: { readAt: expect.any(Date) },
    });
  });

  it("list reads per-user readAt from NotificationRecipient", async () => {
    prisma.notificationRecipient.findMany.mockResolvedValue([
      {
        id: "rec-1",
        notificationId: tenantNotification.id,
        tenantId: "tenant-1",
        userId: "admin-a",
        readAt: null,
        createdAt: new Date(),
        notification: tenantNotification,
      },
    ]);

    const res = await svc.list(adminA, { limit: 10 });

    expect(res.data).toHaveLength(1);
    expect(res.data[0].read).toBe(false);
    expect(res.data[0].readAt).toBeNull();
    expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "admin-a",
        }),
      }),
    );
  });
});
