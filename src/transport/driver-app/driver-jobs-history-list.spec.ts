import { TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.listHistoryByDriver (trip-first)", () => {
  const tenantId = "tenant-1";
  const driverUserId = "driver-1";

  function makeJob(overrides: Record<string, any> = {}) {
    return {
      id: "job1",
      tenantId,
      customerCompanyId: "c1",
      internalRef: "JOB-INT-1",
      externalRef: null,
      jobType: "IMPORT",
      status: "ONGOING",
      invoiceReadyAt: null,
      notes: "n",
      pickupDate: new Date("2026-05-01T00:00:00.000Z"),
      pickupAddress1: "P1",
      pickupAddress2: null,
      pickupPostal: null,
      pickupContactName: null,
      pickupContactPhone: null,
      deliveryAddress1: "D1",
      deliveryAddress2: null,
      deliveryPostal: null,
      receiverName: "R",
      receiverPhone: "1",
      assignedDriverId: null,
      assignedDriver: { id: driverUserId, name: "D" },
      assignedVehicleId: null,
      assignedFleetVehicleId: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      deliveredAt: null,
      podRecipientName: null,
      cancelledReason: null,
      cancelledAt: null,
      cancelledByUserId: null,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:00:00.000Z"),
      items: [],
      documents: [],
      customerCompany: { id: "c1", name: "Customer Co" },
      ...overrides,
    };
  }

  function makeCompletedTrip(job: any, overrides: Record<string, any> = {}) {
    return {
      id: "trip-done-1",
      tenantId,
      jobId: job.id,
      status: TripStatus.COMPLETED,
      pendingState: "NONE",
      plannedStartAt: new Date("2026-05-02T00:00:00.000Z"),
      startedAt: new Date("2026-05-02T01:00:00.000Z"),
      closedAt: new Date("2026-05-10T12:00:00.000Z"),
      updatedAt: new Date("2026-05-10T12:00:00.000Z"),
      jobSequence: 1,
      tripSequence: 1,
      jobTripTemplate: null,
      title: "Leg 1",
      trailerNumber: "TR-99",
      trailerLastLocationCode: null,
      driverEarningCents: 8800,
      earningLabelSnapshot: "Std",
      earningRateMasterId: null,
      completionRuleJson: null,
      vehicleId: null,
      fleetVehicleId: null,
      originLabel: "Port A",
      originAddressLine1: null,
      originAddressLine2: null,
      originPostalCode: null,
      destinationLabel: "Site B",
      destinationAddressLine1: null,
      destinationAddressLine2: null,
      destinationPostalCode: null,
      job,
      ...overrides,
    };
  }

  function makePrismaAndService(
    opts: {
      total: bigint;
      ids: { id: string }[];
      tripsHydrated: any[];
    },
  ) {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ c: opts.total }])
        .mockResolvedValueOnce(opts.ids),
      trip: {
        findMany: jest.fn().mockResolvedValue(opts.tripsHydrated),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const supabaseService = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: "https://signed" } }),
          }),
        },
      }),
    } as any;
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, supabaseService);
    return { svc, prisma };
  }

  it("returns a completed trip while parent job is still ONGOING", async () => {
    const job = makeJob({ status: "ONGOING" });
    const trip = makeCompletedTrip(job);
    const { svc, prisma } = makePrismaAndService({
      total: 1n,
      ids: [{ id: trip.id }],
      tripsHydrated: [trip],
    });

    const res = await svc.listHistoryByDriver(tenantId, driverUserId, {
      month: "2026-05",
      page: 1,
      pageSize: 20,
    });

    expect(res.meta.total).toBe(1);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe("job1");
    expect(res.data[0].status).toBe("ONGOING");
    expect(res.data[0].trips).toHaveLength(1);
    const row = res.data[0].trips![0] as any;
    expect(row.id).toBe("trip-done-1");
    expect(row.status).toBe(TripStatus.COMPLETED);
    expect(row.closedAt).toEqual(trip.closedAt);
    expect(row.jobId).toBe("job1");
    expect(row.jobInternalRef).toBe("JOB-INT-1");
    expect(row.tripDisplayRef).toBe("JOB-INT-1-T01");
    expect(row.customerName).toBe("Customer Co");
    expect(row.originSummary).toBe("Port A");
    expect(row.destinationSummary).toBe("Site B");
    expect(row.driverEarningCents).toBe(8800);
    expect(row.trailerNumber).toBe("TR-99");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("uses linked TripJobItem cargo on history trips instead of cached containerNumber", async () => {
    const job = makeJob({ status: "ONGOING" });
    const trip = makeCompletedTrip(job, {
      containerNumber: "CACHED-OLD",
      tripJobItems: [
        { tenantId, jobItem: { itemCode: "HIST-LIVE" } },
      ],
    });
    const { svc } = makePrismaAndService({
      total: 1n,
      ids: [{ id: trip.id }],
      tripsHydrated: [trip],
    });

    const res = await svc.listHistoryByDriver(tenantId, driverUserId, { month: "2026-05" });
    expect(res.data[0].trips![0]).toMatchObject({
      cargoSource: "TRIP_JOB_ITEM",
      cargoSummary: "HIST-LIVE",
      containerNumber: "HIST-LIVE",
    });
  });

  it("groups multiple completed trips for the same job on one page into one job row", async () => {
    const job = makeJob();
    const t1 = makeCompletedTrip(job, { id: "trip-a", tripSequence: 1, closedAt: new Date("2026-05-12T00:00:00.000Z") });
    const t2 = makeCompletedTrip(job, {
      id: "trip-b",
      tripSequence: 2,
      closedAt: new Date("2026-05-11T00:00:00.000Z"),
    });
    const { svc } = makePrismaAndService({
      total: 2n,
      ids: [{ id: "trip-a" }, { id: "trip-b" }],
      tripsHydrated: [t1, t2],
    });

    const res = await svc.listHistoryByDriver(tenantId, driverUserId, { month: "2026-05" });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].trips?.map((t: any) => t.id)).toEqual(["trip-a", "trip-b"]);
  });

  it("paginates trip rows (meta.total vs page size)", async () => {
    const job = makeJob();
    const trip = makeCompletedTrip(job);
    const { svc, prisma } = makePrismaAndService({
      total: 42n,
      ids: [{ id: trip.id }],
      tripsHydrated: [trip],
    });

    const res = await svc.listHistoryByDriver(tenantId, driverUserId, {
      month: "2026-05",
      page: 2,
      pageSize: 10,
    });

    expect(res.meta.total).toBe(42);
    expect(res.meta.page).toBe(2);
    expect(res.meta.pageSize).toBe(10);
    const idQueryValues = (prisma.$queryRaw.mock.calls[1][0] as any).values ?? [];
    expect(idQueryValues).toEqual(expect.arrayContaining([10, 10]));
  });

  it("scopes history SQL to tenant and assigned driver", async () => {
    const job = makeJob();
    const trip = makeCompletedTrip(job);
    const { svc, prisma } = makePrismaAndService({
      total: 0n,
      ids: [],
      tripsHydrated: [],
    });

    await svc.listHistoryByDriver(tenantId, "other-driver", { month: "2026-05" });
    const countValues = (prisma.$queryRaw.mock.calls[0][0] as any).values ?? [];
    expect(countValues[0]).toBe(tenantId);
    expect(countValues[1]).toBe("other-driver");
  });

  it("uses only COMPLETED/DONE trips in SQL filter", async () => {
    const job = makeJob();
    const trip = makeCompletedTrip(job);
    const { svc, prisma } = makePrismaAndService({
      total: 1n,
      ids: [{ id: trip.id }],
      tripsHydrated: [trip],
    });
    await svc.listHistoryByDriver(tenantId, driverUserId, { month: "2026-05" });
    const countFragment = (prisma.$queryRaw.mock.calls[0][0] as any).strings?.join("") ?? "";
    expect(countFragment).toMatch(/COMPLETED/);
    expect(countFragment).toMatch(/DONE/);
  });

  it("applies month filter on trip completion (DB returns no rows outside range)", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      $queryRaw: jest.fn().mockResolvedValueOnce([{ c: 0n }]).mockResolvedValueOnce([]),
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    const res = await svc.listHistoryByDriver(tenantId, driverUserId, { month: "2026-05" });
    expect(res.meta.total).toBe(0);
    expect(res.data).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.trip).toBeUndefined();
  });
});
