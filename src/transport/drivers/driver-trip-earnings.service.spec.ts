import { BadRequestException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { DriverTripEarningsService } from "./driver-trip-earnings.service";
import {
  parseCalendarMonthToUtcRangeInTimeZone,
  resolveDriverTripEarningCents,
} from "./driver-trip-earnings.helpers";

describe("DriverTripEarningsService (canonical mobile wallet SoT)", () => {
  function makeService(prismaOverrides?: Partial<any>) {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      drivers: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (arg: any) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg(prisma);
      }),
      ...prismaOverrides,
    };
    return { prisma, svc: new DriverTripEarningsService(prisma) };
  }

  it("resolveDriverTripEarningCents prefers payout lines over a stale cache", () => {
    expect(
      resolveDriverTripEarningCents({
        driverEarningCents: 5000,
        payoutLines: [{ totalCents: 6000, isSelectableForTripEarning: true }],
      }),
    ).toBe(6000);
    expect(
      resolveDriverTripEarningCents({
        driverEarningCents: null,
        payoutLines: [
          { totalCents: 7000, isSelectableForTripEarning: true },
          { totalCents: 500, isSelectableForTripEarning: true },
        ],
      }),
    ).toBe(7500);
    expect(
      resolveDriverTripEarningCents({
        driverEarningCents: 9999,
        payoutLines: [
          { amountCents: 80, quantity: 1, isSelectableForTripEarning: true },
          { amountCents: 20, quantity: 2, isSelectableForTripEarning: true },
          { amountCents: 999, quantity: 1, isSelectableForTripEarning: false },
        ],
      }),
    ).toBe(120);
    expect(
      resolveDriverTripEarningCents({
        driverEarningCents: null,
        payoutLines: [{ totalCents: 0, isSelectableForTripEarning: true }],
      }),
    ).toBeNull();
  });

  it("falls back to driverEarningCents only when no payout lines exist", () => {
    expect(
      resolveDriverTripEarningCents({
        driverEarningCents: 5000,
        payoutLines: [],
      }),
    ).toBe(5000);
  });

  it("returns monthly wallet summary matching mobile COMPLETED/DONE rules", async () => {
    const { prisma, svc } = makeService({
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip-1",
            jobId: "job-1",
            title: "Trip 1",
            status: TripStatus.COMPLETED,
            closedAt: new Date("2026-05-20T10:00:00.000Z"),
            updatedAt: new Date("2026-05-20T10:00:00.000Z"),
            driverEarningCents: 5000,
            earningLabelSnapshot: "Fixed payout",
            payoutLines: [{ totalCents: 6000 }],
            job: { internalRef: "JOB-001" },
          },
          {
            id: "trip-2",
            jobId: "job-2",
            title: "Trip 2",
            status: TripStatus.DONE,
            closedAt: null,
            updatedAt: new Date("2026-05-10T10:00:00.000Z"),
            driverEarningCents: null,
            earningLabelSnapshot: null,
            payoutLines: [{ totalCents: 7000 }, { totalCents: 500 }],
            job: { internalRef: "JOB-002" },
          },
        ]),
      },
    });

    const res = await svc.getWalletSummaryByMonth("tenant-1", "driver-1", "2026-05");
    expect(res.month).toBe("2026-05");
    expect(res.completedTripCount).toBe(2);
    expect(res.totalCents).toBe(13500);
    expect(res.trips[0].tripId).toBe("trip-1");
    expect(res.trips[0].driverEarningCents).toBe(6000);
    expect(res.trips[1].tripId).toBe("trip-2");
    expect(res.trips[1].driverEarningCents).toBe(7500);
    const where = prisma.trip.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual([TripStatus.COMPLETED, TripStatus.DONE]);
    expect(where.tenantId).toBe("tenant-1");
    expect(where.assignedDriverUserId).toBe("driver-1");
  });

  it("rejects invalid month values", async () => {
    const { svc } = makeService();
    await expect(
      svc.getWalletSummaryByMonth("tenant-1", "driver-1", "2026-13"),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.getWalletSummaryByMonth("tenant-1", "driver-1", "bad"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("computes tenant-timezone month boundaries (inclusive/exclusive)", () => {
    const range = parseCalendarMonthToUtcRangeInTimeZone(
      "2026-01",
      "Asia/Singapore",
    );
    expect(range.gte.toISOString()).toBe("2025-12-31T16:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-01-31T16:00:00.000Z");

    const yearBoundary = parseCalendarMonthToUtcRangeInTimeZone(
      "2025-12",
      "Asia/Singapore",
    );
    expect(yearBoundary.gte.toISOString()).toBe("2025-11-30T16:00:00.000Z");
    expect(yearBoundary.lt.toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });

  it("sums lifetime earnings across all completed trips with integer cents", async () => {
    const { svc } = makeService({
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            driverEarningCents: 1001,
            payoutLines: [],
          },
          {
            driverEarningCents: null,
            payoutLines: [
              { totalCents: 200, isSelectableForTripEarning: true },
              { totalCents: 50, isSelectableForTripEarning: true },
            ],
          },
          {
            driverEarningCents: -300,
            payoutLines: [{ totalCents: 9999, isSelectableForTripEarning: true }],
          },
        ]),
      },
    });

    const res = await svc.getLifetimeTotals("tenant-1", "driver-1");
    // cache-only 1001 + lines 250 + lines 9999 (cache ignored) = 11250
    expect(res.lifetimeCents).toBe(11250);
    expect(res.completedTripCount).toBe(3);
    expect(res.currency).toBe("SGD");
  });

  it("paginates earnings transactions for a month", async () => {
    const trips = [
      {
        id: "t1",
        jobId: "j1",
        title: "A",
        closedAt: new Date("2026-05-20T10:00:00.000Z"),
        updatedAt: new Date("2026-05-20T10:00:00.000Z"),
        driverEarningCents: 1000,
        earningLabelSnapshot: "Leg A",
        payoutLines: [],
        job: { internalRef: "JOB-A" },
      },
    ];
    const { prisma, svc } = makeService({
      trip: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue(trips),
      },
    });
    prisma.$transaction = jest.fn(async (ops: any[]) => Promise.all(ops));

    const res = await svc.listEarningsTransactions("tenant-1", "driver-1", {
      month: "2026-05",
      page: 1,
      pageSize: 20,
    });
    expect(res.meta.total).toBe(1);
    expect(res.data[0].amountCents).toBe(1000);
    expect(res.data[0].type).toBe("TripCompleted");
    expect(res.data[0].currency).toBe("SGD");
    expect(res.month).toBe("2026-05");
  });

  it("returns empty histories safely", async () => {
    const { svc } = makeService();
    const month = await svc.getWalletSummaryByMonth(
      "tenant-1",
      "driver-1",
      "2026-05",
    );
    expect(month.totalCents).toBe(0);
    expect(month.trips).toEqual([]);

    const lifetime = await svc.getLifetimeTotals("tenant-1", "driver-1");
    expect(lifetime.lifetimeCents).toBe(0);
    expect(lifetime.completedTripCount).toBe(0);
  });

  it("summarizes Finance Driver Incentives from COMPLETED/DONE payout lines", async () => {
    const { prisma, svc } = makeService({
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: "driver-1",
            name: "Ahmad",
            assignedVehicle: { plateNo: "SBA1234A" },
            assignedFleetVehicle: null,
            users: { name: "Ahmad", displayName: "Ahmad" },
          },
        ]),
        findFirst: jest.fn(),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            assignedDriverUserId: "driver-1",
            driverEarningCents: 1,
            payoutLines: [
              { totalCents: 12000, isSelectableForTripEarning: true },
            ],
          },
          {
            assignedDriverUserId: "driver-1",
            driverEarningCents: 1,
            payoutLines: [
              { totalCents: 8000, isSelectableForTripEarning: true },
            ],
          },
        ]),
      },
    });

    const res = await svc.listTenantDriverIncentiveSummaries("tenant-1", {
      month: "2026-05",
    });
    expect(res.month).toBe("2026-05");
    expect(res.data).toEqual([
      {
        driverId: "driver-1",
        driverName: "Ahmad",
        monthCents: 20000,
        completedTripCount: 2,
        averageCents: 10000,
        vehiclePlate: "SBA1234A",
      },
    ]);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
        }),
      }),
    );
  });

  it("returns Finance Driver history without CUIDs and using wallet resolver rows", async () => {
    const { prisma, svc } = makeService({
      drivers: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          userId: "driver-1",
          name: "Ahmad",
          assignedVehicle: null,
          assignedFleetVehicle: { plateNo: "SGF8888Z" },
          users: { name: "Ahmad", displayName: "Ahmad" },
        }),
      },
    });
    prisma.trip.findMany.mockResolvedValue([
      {
        id: "clxxxxxxxxxxxxxxxxxxxxxx",
        jobId: "job-1",
        title: "Port haul",
        status: TripStatus.COMPLETED,
        closedAt: new Date("2026-05-08T02:00:00.000Z"),
        updatedAt: new Date("2026-05-08T02:00:00.000Z"),
        driverEarningCents: 500,
        earningLabelSnapshot: "A-1 haul",
        payoutLines: [{ totalCents: 4500, isSelectableForTripEarning: true }],
        job: { internalRef: "JOB-88" },
      },
    ]);

    const detail = await svc.getDriverIncentiveDetail(
      "tenant-1",
      "driver-1",
      "2026-05",
    );
    expect(detail.driverName).toBe("Ahmad");
    expect(detail.totalCents).toBe(4500);
    expect(detail.completedTripCount).toBe(1);
    expect(detail.averageCents).toBe(4500);
    expect(detail.trips[0]).toMatchObject({
      tripDisplayRef: "JOB-88",
      payoutLabel: "A-1 haul",
      amountCents: 4500,
      jobRef: "JOB-88",
    });
    expect(JSON.stringify(detail.trips)).not.toContain("clxxxxxxxx");
  });
});
