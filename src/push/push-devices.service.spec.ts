import { ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PushDevicesService } from "./push-devices.service";

describe("PushDevicesService", () => {
  const prisma = {
    pushDevice: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  let svc: PushDevicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PushDevicesService(prisma as any);
  });

  const ctx = {
    tenantId: "tenant-1",
    userId: "drv-1",
    role: Role.DRIVER,
  };

  it("registers token for current user and clears disabledAt", async () => {
    prisma.pushDevice.upsert.mockResolvedValue({
      id: "pd-1",
      tenantId: "tenant-1",
      userId: "drv-1",
      platform: "ios",
      expoPushToken: "ExponentPushToken[abc]",
      deviceId: null,
      appVersion: "1.0.0",
      lastSeenAt: new Date(),
      disabledAt: null,
    });

    const res = await svc.register(ctx, {
      expoPushToken: "ExponentPushToken[abc]",
      platform: "ios",
      appVersion: "1.0.0",
    });

    expect(res.userId).toBe("drv-1");
    expect(prisma.pushDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          userId: "drv-1",
          disabledAt: null,
        }),
      }),
    );
  });

  it("unregister disables token for current user only", async () => {
    prisma.pushDevice.findUnique.mockResolvedValue({
      id: "pd-1",
      tenantId: "tenant-1",
      userId: "drv-1",
      expoPushToken: "ExponentPushToken[abc]",
    });
    prisma.pushDevice.update.mockResolvedValue({});

    await svc.unregisterByToken(ctx, "ExponentPushToken[abc]");

    expect(prisma.pushDevice.update).toHaveBeenCalledWith({
      where: { id: "pd-1" },
      data: { disabledAt: expect.any(Date) },
    });
  });

  it("unregister rejects another user's token", async () => {
    prisma.pushDevice.findUnique.mockResolvedValue({
      id: "pd-1",
      tenantId: "tenant-1",
      userId: "drv-2",
      expoPushToken: "ExponentPushToken[abc]",
    });

    await expect(
      svc.unregisterByToken(ctx, "ExponentPushToken[abc]"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("blocks CUSTOMER registration", async () => {
    await expect(
      svc.register(
        { ...ctx, role: Role.CUSTOMER },
        { expoPushToken: "ExponentPushToken[abc]" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
