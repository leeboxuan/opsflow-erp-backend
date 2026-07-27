import { Role, TripStatus } from "@prisma/client";
import { DriverJobsService } from "../driver-app/driver-jobs.service";
import { TransportJobsService } from "../jobs/transport-jobs.service";

describe("TransportJobsService.unpublishTrip", () => {
  function makeService(status: TripStatus, overrides?: Partial<any>) {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status,
          tripSequence: 3,
          jobSequence: 3,
          job: { internalRef: "WF-2026-04-0002-IMP" },
          assignedDriverUserId: "driver-1",
          driverId: "drv-1",
          vehicleId: "veh-1",
          fleetVehicleId: null,
          driverEarningCents: 5000,
          earningLabelSnapshot: "Rate",
          trailerNumber: "T-1",
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: "trip1", status: TripStatus.DRAFT }),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      ...overrides,
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new TransportJobsService(prisma, audit, {} as any);
    return { svc, prisma, audit };
  }

  const opsUser = { userId: "u1", role: Role.TRANSPORT_STAFF, customerCompanyId: null };

  it("PUBLISHED trip can be unpublished to DRAFT", async () => {
    const { svc, prisma, audit } = makeService(TripStatus.PUBLISHED);
    const res = await svc.unpublishTrip("t1", "job1", "trip1", opsUser);
    expect(res).toEqual({
      ok: true,
      tripId: "trip1",
      tripDisplayRef: "WF-0002-IMP-T03",
      status: TripStatus.DRAFT,
    });
    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: {
        status: TripStatus.DRAFT,
        publishedAt: null,
        publishedByUserId: null,
        updatedByUserId: "u1",
      },
    });
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "TRIP_UNPUBLISHED",
      "TRIP",
      "trip1",
      expect.objectContaining({
        jobId: "job1",
        tripDisplayRef: "WF-0002-IMP-T03",
        previousStatus: TripStatus.PUBLISHED,
        nextStatus: TripStatus.DRAFT,
      }),
      "u1",
    );
  });

  it("DRAFT trip returns already unpublished message", async () => {
    const { svc } = makeService(TripStatus.DRAFT);
    await expect(
      svc.unpublishTrip("t1", "job1", "trip1", opsUser),
    ).rejects.toThrow("Trip is already unpublished.");
  });

  it.each([TripStatus.ONGOING, TripStatus.COMPLETED, TripStatus.DONE])(
    "%s trip cannot be unpublished after execution started",
    async (status) => {
      const { svc } = makeService(status);
      await expect(
        svc.unpublishTrip("t1", "job1", "trip1", opsUser),
      ).rejects.toThrow("Trip cannot be unpublished after execution has started.");
    },
  );

  it("CANCELLED trip cannot be unpublished", async () => {
    const { svc } = makeService(TripStatus.CANCELLED);
    await expect(
      svc.unpublishTrip("t1", "job1", "trip1", opsUser),
    ).rejects.toThrow("Cancelled trip cannot be unpublished.");
  });

  it("customer role cannot unpublish", async () => {
    const { svc } = makeService(TripStatus.PUBLISHED);
    await expect(
      svc.unpublishTrip("t1", "job1", "trip1", {
        userId: "c1",
        role: Role.CUSTOMER,
        customerCompanyId: "comp-1",
      }),
    ).rejects.toThrow("read-only");
  });

  it("tenant isolation enforced via tenant-scoped lookup", async () => {
    const { svc, prisma } = makeService(TripStatus.PUBLISHED, {
      trip: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    });
    await expect(
      svc.unpublishTrip("t1", "job1", "trip1", opsUser),
    ).rejects.toThrow("Trip not found");
    expect(prisma.trip.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "trip1", tenantId: "t1", jobId: "job1" },
      }),
    );
  });

  it("preserves assignment, payout, documents and route fields by only updating publish fields", async () => {
    const { svc, prisma } = makeService(TripStatus.PUBLISHED);
    await svc.unpublishTrip("t1", "job1", "trip1", opsUser);
    const data = prisma.trip.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual([
      "publishedAt",
      "publishedByUserId",
      "status",
      "updatedByUserId",
    ]);
  });
});

describe("Driver visibility excludes draft trips after unpublish", () => {
  it("driver active list filters out DRAFT trips", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    await svc.listActiveByDriver("t1", "driver-1", { date: "2026-05-05" });
    const where = prisma.job.count.mock.calls[0][0].where;
    expect(where.trips.some.status.notIn).toEqual([TripStatus.DRAFT, TripStatus.CANCELLED]);
  });
});
