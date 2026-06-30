import { ForbiddenException } from "@nestjs/common";
import { NotificationAudience, Role } from "@prisma/client";
import { NotificationsService } from "./notifications.service";
import type { RealtimeEvent } from "../realtime/realtime-event.types";

describe("NotificationsService", () => {
  const publish = jest.fn();
  const sendForCreatedNotification = jest.fn();
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
    },
    tenantMembership: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  };

  let svc: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new NotificationsService(
      prisma as any,
      { publish } as any,
      { sendForCreatedNotification } as any,
    );
    svc.resetDedupeCache();
    prisma.tenantMembership.findMany.mockResolvedValue([{ userId: "ops-1" }]);
  });

  const opsCtx = {
    tenantId: "tenant-1",
    userId: "ops-1",
    role: Role.OPS,
  };

  it("createFromRealtimeEvent persists recipients and publishes notification.created", async () => {
    prisma.notification.create.mockResolvedValue({
      id: "n-1",
      tenantId: "tenant-1",
      userId: "drv-1",
      role: null,
      audience: NotificationAudience.USER,
      type: "trip.assigned",
      jobId: "job-1",
      tripId: "trip-1",
      driverUserId: "drv-1",
      createdAt: new Date(),
    });
    prisma.notificationRecipient.createMany.mockResolvedValue({ count: 1 });

    const event: RealtimeEvent = {
      type: "trip.assigned",
      tenantId: "tenant-1",
      entityType: "trip",
      entityId: "trip-1",
      jobId: "job-1",
      tripId: "trip-1",
      driverUserId: "drv-1",
      changedAt: new Date().toISOString(),
    };

    await svc.createFromRealtimeEvent(event);

    expect(prisma.notification.create).toHaveBeenCalled();
    expect(prisma.notificationRecipient.createMany).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "notification.created",
        entityType: "notification",
        entityId: "n-1",
        driverUserId: "drv-1",
      }),
    );
    expect(sendForCreatedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "n-1",
        type: "trip.assigned",
        audience: NotificationAudience.USER,
        userId: "drv-1",
      }),
    );
  });

  it("does not enqueue push for TENANT job.created notifications", async () => {
    prisma.notification.create.mockResolvedValue({
      id: "n-tenant",
      tenantId: "tenant-1",
      userId: null,
      role: null,
      audience: NotificationAudience.TENANT,
      type: "job.created",
      jobId: "job-1",
      tripId: null,
      driverUserId: null,
      createdAt: new Date(),
    });
    prisma.notificationRecipient.createMany.mockResolvedValue({ count: 1 });

    await svc.createFromRealtimeEvent({
      type: "job.created",
      tenantId: "tenant-1",
      entityType: "job",
      entityId: "job-1",
      jobId: "job-1",
      changedAt: new Date().toISOString(),
    });

    expect(sendForCreatedNotification).not.toHaveBeenCalled();
  });

  it("deduplicates same type+entity+audience within 3 seconds", async () => {
    prisma.notification.create.mockResolvedValue({
      id: "n-1",
      tenantId: "tenant-1",
      userId: null,
      role: Role.ADMIN,
      audience: NotificationAudience.TENANT,
      jobId: null,
      tripId: null,
      driverUserId: null,
      createdAt: new Date(),
    });
    prisma.notificationRecipient.createMany.mockResolvedValue({ count: 1 });

    const event: RealtimeEvent = {
      type: "job.created",
      tenantId: "tenant-1",
      entityType: "job",
      entityId: "job-1",
      jobId: "job-1",
      changedAt: new Date().toISOString(),
    };

    await svc.createFromRealtimeEvent(event);
    await svc.createFromRealtimeEvent(event);

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it("does not persist dispatch.updated", async () => {
    await svc.createFromRealtimeEvent({
      type: "dispatch.updated",
      tenantId: "tenant-1",
      entityType: "dispatch",
      changedAt: new Date().toISOString(),
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("markRead enforces visibility", async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: "n-1",
      tenantId: "tenant-1",
      audience: NotificationAudience.USER,
      userId: "drv-2",
      role: null,
      type: "trip.assigned",
      title: "x",
      description: null,
      severity: "INFO",
      entityType: "trip",
      entityId: "t1",
      jobId: "j1",
      tripId: "t1",
      driverUserId: "drv-2",
      createdAt: new Date(),
      metadata: null,
    });

    await expect(
      svc.markRead(
        { tenantId: "tenant-1", userId: "drv-1", role: Role.DRIVER },
        "n-1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("unreadCount uses recipient rows for current user", async () => {
    prisma.notificationRecipient.count.mockResolvedValue(2);
    const count = await svc.unreadCount({
      tenantId: "tenant-1",
      userId: "drv-1",
      role: Role.DRIVER,
    });
    expect(count).toBe(2);
    expect(prisma.notificationRecipient.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: "tenant-1",
        userId: "drv-1",
        readAt: null,
      }),
    });
  });

  it("list returns cursor when more than limit", async () => {
    const notif = {
      id: "n-0",
      tenantId: "tenant-1",
      userId: null,
      role: Role.OPS,
      audience: NotificationAudience.TENANT,
      type: "job.created",
      title: "Job",
      description: null,
      severity: "INFO",
      entityType: "job",
      entityId: "job-0",
      jobId: "job-0",
      tripId: null,
      driverUserId: null,
      createdAt: new Date(Date.now() - 1000),
      metadata: null,
    };
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `rec-${i}`,
      notificationId: `n-${i}`,
      tenantId: "tenant-1",
      userId: "ops-1",
      readAt: null,
      createdAt: new Date(),
      notification: { ...notif, id: `n-${i}`, createdAt: new Date(Date.now() - i * 1000) },
    }));
    prisma.notificationRecipient.findMany.mockResolvedValue(rows);

    const res = await svc.list(opsCtx, { limit: 3 });
    expect(res.data).toHaveLength(3);
    expect(res.nextCursor).toBe("rec-2");
  });
});
