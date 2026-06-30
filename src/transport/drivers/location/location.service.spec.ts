import { LocationService } from "./location.service";

describe("LocationService", () => {
  it("accepts recordedAt and saves it as capturedAt", async () => {
    const recordedAt = "2026-05-05T09:10:11.000Z";
    const prisma: any = {
      tenantMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: "m1" }),
      },
      driverLocationLatest: {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: "tenant-1",
          driverUserId: "driver-1",
          lat: 1.2895,
          lng: 103.8495,
          lastMovedAt: new Date("2026-05-05T09:00:00.000Z"),
          lastMovedLat: 1.2895,
          lastMovedLng: 103.8495,
        }),
        upsert: jest.fn().mockResolvedValue({
          driverUserId: "driver-1",
          lat: 1.29,
          lng: 103.85,
          accuracy: 10,
          heading: 45,
          speed: 22,
          recordedAt: new Date(recordedAt),
          capturedAt: new Date(recordedAt),
          lastMovedAt: new Date(recordedAt),
          updatedAt: new Date("2026-05-05T09:11:00.000Z"),
        }),
      },
    };
    const svc = new LocationService(prisma);
    const res = await svc.upsertLocation("tenant-1", "driver-1", {
      lat: 1.29,
      lng: 103.85,
      accuracy: 10,
      heading: 45,
      speed: 22,
      recordedAt,
    });
    const upsertArg = prisma.driverLocationLatest.upsert.mock.calls[0][0];
    expect(upsertArg.update.recordedAt).toEqual(new Date(recordedAt));
    expect(upsertArg.update.capturedAt).toEqual(new Date(recordedAt));
    expect(upsertArg.update.lastMovedAt).toEqual(new Date(recordedAt));
    expect(upsertArg.create.recordedAt).toEqual(new Date(recordedAt));
    expect(upsertArg.create.capturedAt).toEqual(new Date(recordedAt));
    expect(res.recordedAt).toEqual(new Date(recordedAt));
    expect(res.lastMovedAt).toEqual(new Date(recordedAt));
  });

  it("still works without recordedAt and returns recordedAt alias", async () => {
    const now = new Date("2026-05-05T10:00:00.000Z");
    const prisma: any = {
      tenantMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: "m1" }),
      },
      driverLocationLatest: {
        upsert: jest.fn().mockResolvedValue({
          driverUserId: "driver-1",
          lat: 1.29,
          lng: 103.85,
          accuracy: null,
          heading: null,
          speed: null,
          recordedAt: now,
          capturedAt: now,
          lastMovedAt: now,
          updatedAt: now,
        }),
        findUnique: jest.fn().mockResolvedValue({
          driverUserId: "driver-1",
          lat: 1.29,
          lng: 103.85,
          accuracy: null,
          heading: null,
          speed: null,
          recordedAt: now,
          capturedAt: now,
          lastMovedAt: now,
          updatedAt: now,
        }),
      },
    };
    const svc = new LocationService(prisma);
    const saved = await svc.upsertLocation("tenant-1", "driver-1", {
      lat: 1.29,
      lng: 103.85,
    });
    expect(saved.recordedAt).toEqual(now);
    expect(saved.lastMovedAt).toEqual(now);

    const me = await svc.getLatestLocation("tenant-1", "driver-1");
    expect(me?.capturedAt).toEqual(now);
    expect(me?.recordedAt).toEqual(now);
    expect(me?.lastMovedAt).toEqual(now);
  });
});
