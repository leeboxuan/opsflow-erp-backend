import { BadRequestException } from "@nestjs/common";
import { Role, TripStatus } from "@prisma/client";
import { TransportJobsService } from "../jobs/transport-jobs.service";
import { DriverTripEarningsService } from "../drivers/driver-trip-earnings.service";
import { resolveDriverTripEarningCents } from "../drivers/driver-trip-earnings.helpers";
import {
  resolveCompletedTripPayoutState,
  selectableTripPayoutTotalCents,
} from "../../statistics/statistics.predicates";
import {
  DRIVER_PAYOUT_LOCKED_AFTER_PUBLISH,
  resolveCanonicalTripPayoutCents,
  tripPayoutTotalCents,
} from "./trip-payout.helpers";

const CANONICAL_LINES = [
  {
    amountCents: 80,
    quantity: 1,
    totalCents: null as number | null,
    isSelectableForTripEarning: true,
  },
  {
    amountCents: 20,
    quantity: 2,
    totalCents: null as number | null,
    isSelectableForTripEarning: true,
  },
  {
    amountCents: 999,
    quantity: 1,
    totalCents: 999,
    isSelectableForTripEarning: false,
  },
];

function makeJobsService(prisma: any) {
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const supabaseService = { getClient: jest.fn() } as any;
  return new TransportJobsService(prisma, audit, supabaseService);
}

describe("Phase 3 driver payout integrity", () => {
  it("wallet, admin, and Statistics resolvers agree on the canonical 120 example", () => {
    const trip = {
      status: TripStatus.COMPLETED,
      driverEarningCents: 1119,
      payoutLines: CANONICAL_LINES,
    };
    expect(tripPayoutTotalCents(CANONICAL_LINES)).toBe(120);
    expect(selectableTripPayoutTotalCents(CANONICAL_LINES)).toBe(120);
    expect(resolveCanonicalTripPayoutCents(trip)).toBe(120);
    expect(resolveDriverTripEarningCents(trip)).toBe(120);
    expect(resolveCompletedTripPayoutState(trip)).toEqual({
      kind: "recorded",
      totalCents: 120,
    });
  });

  it("wallet does not return a stale cache when canonical payout lines exist", async () => {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip-1",
            jobId: "job-1",
            title: "Trip 1",
            status: TripStatus.COMPLETED,
            closedAt: new Date("2026-08-01T04:00:00.000Z"),
            updatedAt: new Date("2026-08-01T04:00:00.000Z"),
            driverEarningCents: 50_000,
            earningLabelSnapshot: "stale",
            payoutLines: CANONICAL_LINES,
            job: { internalRef: "JOB-001" },
          },
        ]),
      },
    };
    const svc = new DriverTripEarningsService(prisma);
    const wallet = await svc.getWalletSummaryByMonth(
      "tenant-1",
      "driver-1",
      "2026-08",
    );
    expect(wallet.totalCents).toBe(120);
    expect(wallet.trips[0].driverEarningCents).toBe(120);
  });

  it.each([
    TripStatus.PUBLISHED,
    TripStatus.ONGOING,
    TripStatus.COMPLETED,
    TripStatus.DONE,
    TripStatus.CANCELLED,
  ])("rejects ordinary payout mutation when trip is %s", async (status) => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status,
        }),
        update: jest.fn(),
      },
      tripPayoutLine: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const svc = makeJobsService(prisma);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [
            {
              label: "L1",
              quantity: 1,
              amountCents: 100,
              totalCents: 100,
              isManual: true,
            },
          ],
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.replaceTripPayoutLines(
        "t1",
        "job1",
        "trip1",
        [{ label: "L1", quantity: 1, amountCents: 100, totalCents: 100 } as any],
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(DRIVER_PAYOUT_LOCKED_AFTER_PUBLISH);
    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: null } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(DRIVER_PAYOUT_LOCKED_AFTER_PUBLISH);
    expect(prisma.tripPayoutLine.deleteMany).not.toHaveBeenCalled();
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("allows DRAFT payout mutation and recomputes the cache from selectable lines", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", tenantId: "t1" }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: TripStatus.DRAFT,
        }),
        update: tripUpdate,
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const svc = makeJobsService(prisma);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.replaceTripPayoutLines(
      "t1",
      "job1",
      "trip1",
      CANONICAL_LINES.map((line, idx) => ({
        label: `L${idx + 1}`,
        quantity: line.quantity,
        amountCents: line.amountCents,
        totalCents: line.totalCents,
        isSelectableForTripEarning: line.isSelectableForTripEarning,
      })) as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ driverEarningCents: 120 }),
    });
  });

  it("publish recomputes driverEarningCents from selectable lines, ignoring stale cache", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({ id: "trip1" });
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: TripStatus.DRAFT,
          driverEarningCents: 50_000,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
          jobId: "job1",
        }),
        update: tripUpdate,
        findMany: jest.fn().mockResolvedValue([]),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
          jobType: null,
          _count: { items: 0 },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue(
          CANONICAL_LINES.map((line, idx) => ({
            id: `pl${idx}`,
            label: `L${idx + 1}`,
            isManual: false,
            requiresManualAmount: false,
            ...line,
          })),
        ),
      },
      tripJobItem: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = makeJobsService(prisma);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.publishTrip("t1", "job1", "trip1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        status: TripStatus.PUBLISHED,
        driverEarningCents: 120,
      }),
    });
  });

  it("keeps payout lines when a published trip is cancelled", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: TripStatus.PUBLISHED,
          assignedDriverUserId: "u1",
          startedAt: null,
          closedAt: null,
          documents: [],
          payoutLines: [{ id: "pl1" }],
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      tripPayoutLine: { deleteMany: jest.fn() },
    };
    const svc = makeJobsService(prisma);
    const result = await svc.deleteTrip("t1", "job1", "trip1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });
    expect(result).toEqual({
      success: true,
      mode: "cancelled",
      tripId: "trip1",
      status: TripStatus.CANCELLED,
    });
    expect(prisma.tripPayoutLine.deleteMany).not.toHaveBeenCalled();
    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ status: TripStatus.CANCELLED }),
    });
  });

  it("excludes cancelled trips from wallet completed earnings", async () => {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverTripEarningsService(prisma);
    await svc.getWalletSummaryByMonth("tenant-1", "driver-1", "2026-08");
    expect(prisma.trip.findMany.mock.calls[0][0].where.status.in).toEqual([
      TripStatus.COMPLETED,
      TripStatus.DONE,
    ]);
  });

  it("excludes cancelled trips from Statistics recorded payout and GP cost", () => {
    expect(
      resolveCompletedTripPayoutState({
        status: TripStatus.CANCELLED,
        driverEarningCents: 120,
        payoutLines: CANONICAL_LINES,
      }),
    ).toBeNull();
  });
});
