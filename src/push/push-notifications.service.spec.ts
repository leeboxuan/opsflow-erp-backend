import { NotificationAudience } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { PushNotificationsService } from "./push-notifications.service";
import type { ExpoPushSendFn } from "./expo-push.client";

describe("PushNotificationsService", () => {
  const prisma = {
    pushDevice: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const sendFn: jest.MockedFunction<ExpoPushSendFn> = jest.fn();

  let svc: PushNotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    const config = {
      get: jest.fn((key: string) =>
        key === "EXPO_PUSH_ENABLED" ? "true" : undefined,
      ),
    } as unknown as ConfigService;
    svc = new PushNotificationsService(prisma as any, config);
    sendFn.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
    ]);
  });

  it("sends push for driver USER trip.assigned notification", async () => {
    prisma.pushDevice.findMany.mockResolvedValue([
      { expoPushToken: "ExponentPushToken[abc]" },
    ]);
    prisma.pushDevice.updateMany.mockResolvedValue({ count: 0 });

    await svc.deliverDriverPush(
      {
        id: "n-1",
        tenantId: "tenant-1",
        userId: "drv-1",
        audience: NotificationAudience.USER,
        type: "trip.assigned",
        jobId: "job-1",
        tripId: "trip-1",
      },
      sendFn,
    );

    expect(sendFn).toHaveBeenCalledWith([
      expect.objectContaining({
        to: "ExponentPushToken[abc]",
        title: "New trip assigned",
        data: expect.objectContaining({
          type: "trip.assigned",
          notificationId: "n-1",
          jobId: "job-1",
          tripId: "trip-1",
        }),
      }),
    ]);
  });

  it("does not push TENANT audience admin notifications", async () => {
    await svc.deliverDriverPush(
      {
        id: "n-2",
        tenantId: "tenant-1",
        userId: null,
        audience: NotificationAudience.TENANT,
        type: "job.created",
        jobId: "job-1",
        tripId: null,
      },
      sendFn,
    );

    expect(sendFn).not.toHaveBeenCalled();
    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
  });

  it("disables invalid Expo tokens", async () => {
    prisma.pushDevice.findMany.mockResolvedValue([
      { expoPushToken: "ExponentPushToken[bad]" },
    ]);
    sendFn.mockResolvedValue([
      {
        status: "error",
        message: "Device not registered",
        details: { error: "DeviceNotRegistered" },
      },
    ]);

    await svc.deliverDriverPush(
      {
        id: "n-3",
        tenantId: "tenant-1",
        userId: "drv-1",
        audience: NotificationAudience.USER,
        type: "trip.published",
        jobId: null,
        tripId: "trip-1",
      },
      sendFn,
    );

    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
      where: {
        expoPushToken: { in: ["ExponentPushToken[bad]"] },
        disabledAt: null,
      },
      data: { disabledAt: expect.any(Date) },
    });
  });

  it("sendForCreatedNotification does not throw when Expo fails", async () => {
    jest
      .spyOn(svc, "deliverDriverPush")
      .mockRejectedValue(new Error("network down"));

    expect(() =>
      svc.sendForCreatedNotification({
        id: "n-4",
        tenantId: "tenant-1",
        userId: "drv-1",
        audience: NotificationAudience.USER,
        type: "trip.cancelled",
        jobId: "job-1",
        tripId: "trip-1",
      }),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 10));
  });
});
