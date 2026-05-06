import { DriverJobsService } from "./driver-jobs.service";

describe("driver jobs published-trip visibility", () => {
  it("getOneForDriver requests only published trips (non-draft)", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "c1",
          internalRef: "JOB-1",
          externalRef: null,
          jobType: "LCL",
          status: "ONGOING",
          invoiceReadyAt: null,
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "Receiver",
          receiverPhone: "123",
          pickupDate: null,
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress2: null,
          deliveryPostal: null,
          assignedDriverId: "u1",
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
          createdAt: new Date(),
          updatedAt: new Date(),
          customerCompany: { id: "c1", name: "Customer A" },
          assignedDriver: { id: "u1", name: "Driver A" },
          items: [],
          documents: [],
          trips: [],
        }),
      },
      $transaction: jest.fn().mockResolvedValue([null, null]),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new DriverJobsService(prisma, audit, supabaseService);

    await svc.getOneForDriver("t1", "job1", "u1");

    const args = prisma.job.findFirst.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { trips: { none: {} } },
      { trips: { some: { status: { notIn: ["DRAFT", "CANCELLED"] } } } },
    ]);
    expect(args.include.trips.where).toEqual({ status: { notIn: ["DRAFT", "CANCELLED"] } });
  });
});

describe("driver trip completion requirements", () => {
  it("fails completion when required trip document is missing", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "c1",
          assignedDriverId: "u1",
          jobType: "IMPORT",
          status: "ONGOING",
          documents: [],
        }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "u1",
          completionRuleJson: null,
        }),
        update: jest.fn(),
        count: jest.fn(),
      },
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "r1",
            tripId: "trip1",
            type: "DELIVERY_DO",
            label: "Delivery DO",
            isRequired: true,
            requiresSignature: false,
            minCount: 1,
          },
        ]),
      },
      tripDocument: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new DriverJobsService(prisma, audit, supabaseService);
    await expect(svc.completeTrip("t1", "job1", "trip1", "u1")).rejects.toThrow(
      "Missing required trip documents: DELIVERY_DO",
    );
  });
});

describe("completion requirements: customer signature vs DELIVERY_DO", () => {
  function basePrismaForRequirements(tripDocRows: any[]) {
    return {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          trailerNumber: "T1",
          plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
          createdAt: new Date("2026-04-30T08:00:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
            createdAt: new Date("2026-04-30T08:00:00.000Z"),
          },
        ]),
      },
      tripDocument: { findMany: jest.fn().mockResolvedValue(tripDocRows) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  it("unsigned DELIVERY_DO returns POD_SIGNATURE as missing (customer signature)", async () => {
    const prisma: any = basePrismaForRequirements([
      { type: "DELIVERY_DO", signedAt: null, isSigned: false },
    ]);
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    const res = await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");
    expect(res.missingDocuments).toContain("POD_SIGNATURE");
    expect(res.missingDocuments).not.toContain("DELIVERY_DO");
  });

  it("signed DELIVERY_DO (signedAt) does not list POD_SIGNATURE missing", async () => {
    const prisma: any = basePrismaForRequirements([
      {
        type: "DELIVERY_DO",
        signedAt: new Date("2026-04-30T09:00:00.000Z"),
        isSigned: false,
      },
    ]);
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    const res = await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");
    expect(res.missingDocuments).not.toContain("POD_SIGNATURE");
  });

  it("signed DELIVERY_DO (isSigned only) does not list POD_SIGNATURE missing", async () => {
    const prisma: any = basePrismaForRequirements([
      { type: "DELIVERY_DO", signedAt: null, isSigned: true },
    ]);
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    const res = await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");
    expect(res.missingDocuments).not.toContain("POD_SIGNATURE");
  });

  it("active POD_SIGNATURE upload satisfies signature without signed DELIVERY_DO", async () => {
    const prisma: any = basePrismaForRequirements([
      { type: "DELIVERY_DO", signedAt: null, isSigned: false },
      { type: "POD_SIGNATURE", signedAt: null, isSigned: false },
    ]);
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    const res = await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");
    expect(res.missingDocuments).not.toContain("POD_SIGNATURE");
  });

  it("queries only active trip documents for completion requirements", async () => {
    const prisma: any = basePrismaForRequirements([
      { type: "DELIVERY_DO", signedAt: null, isSigned: false },
    ]);
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");

    expect(prisma.tripDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          tripId: "trip1",
          isActive: true,
          type: {
            in: ["DELIVERY_DO", "POD_SIGNATURE", "PICKUP_DO"],
          },
        }),
      }),
    );
  });
});

describe("completeTrip completion docs visibility", () => {
  it("checks completion requirements using only active trip documents", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
          createdAt: new Date("2026-04-30T01:00:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
            createdAt: new Date("2026-04-30T01:00:00.000Z"),
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
      tripDocument: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn().mockResolvedValue(undefined) } as any, { getClient: jest.fn() } as any);

    await expect(svc.completeTrip("t1", "job1", "trip1", "driver-1")).rejects.toThrow(
      "Missing required trip documents: DELIVERY_DO",
    );
    expect(prisma.tripDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          tripId: "trip1",
          isActive: true,
          type: {
            in: ["DELIVERY_DO", "POD_SIGNATURE", "PICKUP_DO"],
          },
        }),
      }),
    );
  });
});

describe("DriverJobsService.listActiveByDriver date visibility", () => {
  const tenantId = "t1";
  const driverUserId = "u1";
  const today = "2026-04-29";

  function makeJob(overrides: Record<string, any> = {}) {
    return {
      id: "job1",
      tenantId,
      customerCompanyId: "c1",
      internalRef: "JOB-1",
      externalRef: null,
      jobType: "LCL",
      status: "ONGOING",
      invoiceReadyAt: null,
      notes: null,
      pickupDate: new Date("2026-04-28T00:00:00.000Z"),
      pickupAddress1: "A",
      pickupAddress2: null,
      pickupPostal: null,
      pickupContactName: null,
      pickupContactPhone: null,
      deliveryAddress1: "B",
      deliveryAddress2: null,
      deliveryPostal: null,
      receiverName: "Receiver",
      receiverPhone: "123",
      assignedDriverId: driverUserId,
      assignedDriver: { id: driverUserId, name: "Driver A" },
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
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      items: [],
      documents: [],
      trips: [],
      customerCompany: { id: "c1", name: "Customer A" },
      ...overrides,
    };
  }

  it("returns job when non-draft trip plannedStartAt is within requested day", async () => {
    const prisma: any = {
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          makeJob({
            pickupDate: new Date("2026-04-28T00:00:00.000Z"),
            trips: [
              {
                id: "trip1",
                status: "PUBLISHED",
                plannedStartAt: new Date("2026-04-29T09:00:00.000Z"),
                pendingState: "NONE",
                driverEarningCents: 12500,
              },
            ],
          }),
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "job1" }]),
      vehicle: { findMany: jest.fn() },
      fleetVehicle: { findMany: jest.fn() },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new DriverJobsService(prisma, audit, supabaseService);

    const result = await svc.listActiveByDriver(tenantId, driverUserId, { date: today });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("job1");
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.job.count).toHaveBeenCalled();

    const countWhere = prisma.job.count.mock.calls[0][0].where;
    expect(countWhere.AND?.[0]?.OR?.[0]?.trips?.some).toEqual({
      status: { notIn: ["DRAFT", "CANCELLED"] },
      plannedStartAt: {
        gte: new Date("2026-04-29T00:00:00.000Z"),
        lt: new Date("2026-04-30T00:00:00.000Z"),
      },
    });
  });

  it("uses pickupDate fallback when no non-draft trip has plannedStartAt", async () => {
    const prisma: any = {
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeJob({
          pickupDate: new Date("2026-04-29T08:00:00.000Z"),
          trips: [
            {
              id: "trip1",
              status: "PUBLISHED",
              plannedStartAt: null,
              pendingState: "NONE",
              driverEarningCents: 1000,
            },
          ],
        })]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "job1" }]),
      vehicle: { findMany: jest.fn() },
      fleetVehicle: { findMany: jest.fn() },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new DriverJobsService(prisma, audit, supabaseService);

    await svc.listActiveByDriver(tenantId, driverUserId, { date: today });

    const countWhere = prisma.job.count.mock.calls[0][0].where;
    expect(countWhere.AND?.[0]?.OR?.[1]?.AND?.[0]?.trips?.none).toEqual({
      status: { notIn: ["DRAFT", "CANCELLED"] },
      plannedStartAt: { not: null },
    });
    expect(countWhere.AND?.[0]?.OR?.[1]?.AND?.[1]?.pickupDate).toEqual({
      gte: new Date("2026-04-29T00:00:00.000Z"),
      lt: new Date("2026-04-30T00:00:00.000Z"),
    });
  });

  it("does not treat DRAFT trips as visible execution trips", async () => {
    const prisma: any = {
      job: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      vehicle: { findMany: jest.fn() },
      fleetVehicle: { findMany: jest.fn() },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new DriverJobsService(prisma, audit, supabaseService);

    const result = await svc.listActiveByDriver(tenantId, driverUserId, { date: today });

    expect(result.data).toHaveLength(0);
    const countWhere = prisma.job.count.mock.calls[0][0].where;
    expect(countWhere.AND?.[0]?.OR?.[0]?.trips?.some?.status).toEqual({
      notIn: ["DRAFT", "CANCELLED"],
    });
    expect(countWhere.status).toEqual({ in: ["ONGOING"] });
  });

  it("excludes CANCELLED trips from active visibility rules", async () => {
    const prisma: any = {
      job: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      vehicle: { findMany: jest.fn() },
      fleetVehicle: { findMany: jest.fn() },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new DriverJobsService(prisma, audit, supabaseService);

    await svc.listActiveByDriver(tenantId, driverUserId, { date: today });

    const countWhere = prisma.job.count.mock.calls[0][0].where;
    expect(countWhere.AND?.[0]?.OR?.[0]?.trips?.some?.status).toEqual({
      notIn: ["DRAFT", "CANCELLED"],
    });
  });
});

describe("DriverJobsService trip assignment and trailer checkout", () => {
  it("rejects completion when driver is not assigned to trip", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "other-driver",
          plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
          createdAt: new Date("2026-04-30T01:00:00.000Z"),
        }),
      },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    await expect(svc.completeTrip("t1", "job1", "trip1", "driver-1")).rejects.toThrow(
      "You are not assigned to this trip",
    );
  });

  it("requires trailer checkout only for last open trip of the day", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          trailerNumber: "TRL-123",
          plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
          createdAt: new Date("2026-04-30T01:00:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
            createdAt: new Date("2026-04-30T01:00:00.000Z"),
          },
        ]),
      },
      tripDocument: { findMany: jest.fn().mockResolvedValue([{ type: "DELIVERY_DO" }, { type: "POD_SIGNATURE" }]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    const res = await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");
    expect(res.requiresTrailerCheckout).toBe(true);
  });

  it("uses tenant timezone day window for boundary at UTC edge", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          plannedStartAt: new Date("2026-04-30T15:30:00.000Z"), // 2026-04-30 23:30 SGT
          createdAt: new Date("2026-04-30T15:30:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([
          // same tenant day (SGT): should be included
          {
            id: "trip1",
            plannedStartAt: new Date("2026-04-30T15:30:00.000Z"),
            createdAt: new Date("2026-04-30T15:30:00.000Z"),
          },
          // next tenant day (SGT): should be excluded by where window
          {
            id: "trip2",
            plannedStartAt: new Date("2026-04-30T16:30:00.000Z"), // 2026-05-01 00:30 SGT
            createdAt: new Date("2026-04-30T16:30:00.000Z"),
          },
        ]),
      },
      tripDocument: {
        findMany: jest.fn().mockResolvedValue([{ type: "DELIVERY_DO" }, { type: "POD_SIGNATURE" }]),
      },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");

    const where = prisma.trip.findMany.mock.calls[0][0].where;
    expect(where.OR[0].plannedStartAt.gte).toEqual(new Date("2026-04-29T16:00:00.000Z"));
    expect(where.OR[0].plannedStartAt.lt).toEqual(new Date("2026-04-30T16:00:00.000Z"));
  });

  it("falls back to Asia/Singapore timezone when tenant timezone missing", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: null }) },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          plannedStartAt: new Date("2026-04-30T00:00:00.000Z"),
          createdAt: new Date("2026-04-30T00:00:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tripDocument: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");
    const where = prisma.trip.findMany.mock.calls[0][0].where;
    expect(where.OR[0].plannedStartAt.gte).toEqual(new Date("2026-04-29T16:00:00.000Z"));
  });

  it("caches tenant timezone across repeated completion requirement calls", async () => {
    const tenantFindUnique = jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" });
    const prisma: any = {
      tenant: { findUnique: tenantFindUnique },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          trailerNumber: "T1",
          plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
          createdAt: new Date("2026-04-30T08:00:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
            createdAt: new Date("2026-04-30T08:00:00.000Z"),
          },
        ]),
      },
      tripDocument: { findMany: jest.fn().mockResolvedValue([{ type: "DELIVERY_DO" }, { type: "POD_SIGNATURE" }]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);

    await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");
    await svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1");

    expect(tenantFindUnique).toHaveBeenCalledTimes(1);
  });

  it("uses fallback timezone when tenant lookup fails with P2024", async () => {
    const tenantFindUnique = jest.fn().mockRejectedValue({ code: "P2024", message: "pool timeout" });
    const prisma: any = {
      tenant: { findUnique: tenantFindUnique },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          plannedStartAt: new Date("2026-04-30T15:30:00.000Z"),
          createdAt: new Date("2026-04-30T15:30:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tripDocument: { findMany: jest.fn().mockResolvedValue([{ type: "DELIVERY_DO" }, { type: "POD_SIGNATURE" }]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);

    await expect(
      svc.getTripCompletionRequirements("t1", "job1", "trip1", "driver-1"),
    ).resolves.toEqual(expect.objectContaining({ canComplete: true }));

    const where = prisma.trip.findMany.mock.calls[0][0].where;
    expect(where.OR[0].plannedStartAt.gte).toEqual(new Date("2026-04-29T16:00:00.000Z"));
  });

  it("rejects completion when trip is not ONGOING", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          assignedDriverUserId: "driver-1",
          plannedStartAt: new Date("2026-04-30T00:00:00.000Z"),
          createdAt: new Date("2026-04-30T00:00:00.000Z"),
        }),
      },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    await expect(svc.completeTrip("t1", "job1", "trip1", "driver-1")).rejects.toThrow(
      "Trip must be ONGOING to complete",
    );
  });

  it("persists trailer checkout GPS and parked timestamp on last trip completion", async () => {
    const tripUpdate = jest.fn();
    const tripDocumentCreate = jest.fn();
    const tx = {
      trip: { update: tripUpdate },
      tripDocument: { create: tripDocumentCreate },
    };
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", documents: [] }),
        update: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING", completedAt: null }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "ONGOING",
          assignedDriverUserId: "driver-1",
          trailerNumber: "TRL-123",
          plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
          createdAt: new Date("2026-04-30T01:00:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
            createdAt: new Date("2026-04-30T01:00:00.000Z"),
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
      tripDocument: {
        findMany: jest.fn().mockResolvedValue([{ type: "DELIVERY_DO" }, { type: "POD_SIGNATURE" }]),
      },
      masterTrailerLocation: {
        findFirst: jest.fn().mockResolvedValue({ code: "G7", name: "Gul 7" }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const supabaseService = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn().mockResolvedValue({ error: null }),
          }),
        },
      }),
    } as any;
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, supabaseService);
    jest.spyOn(svc, "getOneForDriver").mockResolvedValue({ trips: [{ id: "trip1" }] } as any);

    await svc.completeTrip("t1", "job1", "trip1", "driver-1", {
      trailerParkingLocationCode: "G7",
      trailerParkingLat: 1.3001,
      trailerParkingLng: 103.7002,
      trailerEndPhoto: {
        buffer: Buffer.from("x"),
        mimetype: "image/jpeg",
        originalname: "end.jpg",
        size: 1,
      } as any,
    });

    expect(tripUpdate).toHaveBeenCalled();
    const updateData = tripUpdate.mock.calls[0][0].data;
    expect(updateData.trailerParkingLat).toBe(1.3001);
    expect(updateData.trailerParkingLng).toBe(103.7002);
    expect(updateData.trailerParkedAt).toBeInstanceOf(Date);
  });
});

describe("Driver trip detail endpoint service contract", () => {
  it("assigned driver can read trip detail with trailer fields and signed photo urls", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          title: "Trip 1",
          displayTitle: null,
          status: "ONGOING",
          plannedStartAt: new Date("2026-04-30T01:00:00.000Z"),
          jobSequence: 1,
          tripSequence: 1,
          originLabel: "Origin A",
          destinationLabel: "Dest B",
          originAddressLine1: null,
          originAddressLine2: null,
          originPostalCode: null,
          originCountry: null,
          originLat: 1.11,
          originLng: 103.61,
          destinationAddressLine1: null,
          destinationAddressLine2: null,
          destinationPostalCode: null,
          destinationCountry: null,
          destinationLat: 1.22,
          destinationLng: 103.72,
          publishedAt: new Date("2026-04-30T00:30:00.000Z"),
          startedAt: new Date("2026-04-30T01:00:00.000Z"),
          closedAt: null,
          assignedDriverUserId: "driver-1",
          trailerNumber: "TRL-1",
          trailerLastLocationCode: "G7",
          trailerParkedAt: new Date("2026-04-30T10:00:00.000Z"),
          trailerParkingLat: 1.31,
          trailerParkingLng: 103.71,
          job: {
            id: "job1",
            internalRef: "JOB-1",
            externalRef: "EXT-1",
            jobType: "IMPORT",
            status: "ONGOING",
            customerCompany: { name: "Customer A" },
            items: [{ id: "itm1", itemCode: "SKU1", description: "Item 1", qty: 2 }],
          },
          documents: [
            {
              id: "doc-start",
              type: "TRAILER_START_PHOTO",
              storageKey: "k1",
              originalName: "s.jpg",
              mimeType: "image/jpeg",
              sizeBytes: 100,
              isActive: true,
              createdAt: new Date("2026-04-30T01:01:00.000Z"),
              updatedAt: new Date("2026-04-30T01:01:00.000Z"),
              uploadedByUserId: "driver-1",
              uploadedByNameSnapshot: "Driver A",
              generatedBySystem: false,
              generatedSource: null,
              requiresSignature: false,
              isSigned: false,
              signedAt: null,
              signedByUserId: null,
              signedByName: null,
              tripId: "trip1",
              jobId: "job1",
            },
            {
              id: "doc-end",
              type: "TRAILER_END_PHOTO",
              storageKey: "k2",
              originalName: "e.jpg",
              mimeType: "image/jpeg",
              sizeBytes: 100,
              isActive: true,
              createdAt: new Date("2026-04-30T10:01:00.000Z"),
              updatedAt: new Date("2026-04-30T10:01:00.000Z"),
              uploadedByUserId: "driver-1",
              uploadedByNameSnapshot: "Driver A",
              generatedBySystem: false,
              generatedSource: null,
              requiresSignature: false,
              isSigned: false,
              signedAt: null,
              signedByUserId: null,
              signedByName: null,
              tripId: "trip1",
              jobId: "job1",
            },
          ],
        }),
      },
      masterTrailerLocation: { findFirst: jest.fn().mockResolvedValue({ name: "Gul 7" }) },
    };
    const supabaseService = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl: jest
              .fn()
              .mockResolvedValueOnce({ data: { signedUrl: "https://signed/start" } })
              .mockResolvedValueOnce({ data: { signedUrl: "https://signed/end" } }),
          }),
        },
      }),
    } as any;
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, supabaseService);

    const res = await svc.getTripDetailForDriver("t1", "trip1", "driver-1");
    expect(res.id).toBe("trip1");
    expect(res.tripDisplayRef).toBe("JOB-1-T01");
    expect(res.trailerNumber).toBe("TRL-1");
    expect(res.trailerLastLocationName).toBe("Gul 7");
    expect(res.trailerStartPhotoUrl).toBe("https://signed/start");
    expect(res.trailerEndPhotoUrl).toBe("https://signed/end");
    const startDoc = res.documents.find((d: any) => d.type === "TRAILER_START_PHOTO");
    expect(startDoc?.fileName).toBe("s.jpg");
    expect(startDoc?.originalFileName).toBe("s.jpg");
    expect(startDoc?.mimeType).toBe("image/jpeg");
    expect(startDoc?.fileSizeBytes).toBe(100);
    expect(startDoc?.uploadedByUserId).toBe("driver-1");
    expect(startDoc?.uploadedByName).toBe("Driver A");
    expect(startDoc?.uploadedByCurrentDriver).toBe(true);
    expect(startDoc?.canDelete).toBe(false);
  });

  it("other driver cannot read trip detail", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          assignedDriverUserId: "driver-2",
          status: "ONGOING",
          documents: [],
          job: { items: [] },
        }),
      },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, { getClient: jest.fn() } as any);
    await expect(svc.getTripDetailForDriver("t1", "trip1", "driver-1")).rejects.toThrow(
      "Trip not found",
    );
  });
});

describe("DriverJobsService.listActiveByDriver trip execution card", () => {
  const tenantId = "t1";
  const driverUserId = "driver-1";

  function makeActiveJobWithTrip(tripOverrides: Record<string, any> = {}) {
    return {
      id: "job1",
      tenantId,
      customerCompanyId: "c1",
      internalRef: "INT-REF-1",
      externalRef: null,
      jobType: "IMPORT",
      status: "ONGOING",
      invoiceReadyAt: null,
      notes: "Handle with care",
      pickupDate: new Date("2026-04-29T08:00:00.000Z"),
      pickupAddress1: "Job Pickup Rd 1",
      pickupAddress2: "Blk 1",
      pickupPostal: "111111",
      pickupContactName: null,
      pickupContactPhone: null,
      deliveryAddress1: "Job Del Rd",
      deliveryAddress2: null,
      deliveryPostal: "222222",
      receiverName: "R",
      receiverPhone: "9",
      assignedDriverId: driverUserId,
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
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      items: [],
      documents: [],
      customerCompany: { id: "c1", name: "ACME Corp" },
      trips: [
        {
          id: "trip1",
          jobId: "job1",
          jobSequence: 1,
          tripSequence: 1,
          status: "PUBLISHED",
          pendingState: "NONE",
          plannedStartAt: new Date("2026-04-29T10:00:00.000Z"),
          jobTripTemplate: null,
          startedAt: null,
          closedAt: null,
          trailerNumber: "TN99",
          trailerLastLocationCode: null,
          driverEarningCents: 5000,
          earningLabelSnapshot: "Linehaul",
          earningRateMasterId: null,
          completionRuleJson: null,
          title: "Leg 1",
          originLabel: null,
          originAddressLine1: "Trip Origin St 100",
          originAddressLine2: null,
          originPostalCode: "333333",
          destinationLabel: null,
          destinationAddressLine1: "Trip Dest Ave",
          destinationAddressLine2: "Suite 2",
          destinationPostalCode: "444444",
          ...tripOverrides,
        },
      ],
    };
  }

  it("returns pickup/delivery address fields from trip route when set", async () => {
    const prisma: any = {
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeActiveJobWithTrip()]),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    const result = await svc.listActiveByDriver(tenantId, driverUserId, {
      sortBy: "createdAt",
      sortDir: "asc",
    });
    const trip = result.data[0].trips?.[0] as any;
    expect(trip.jobId).toBe("job1");
    expect(trip.tripSequence).toBe(1);
    expect(trip.tripDisplayRef).toBe("INT-REF-1-T01");
    expect(trip.jobInternalRef).toBe("INT-REF-1");
    expect(trip.customerName).toBe("ACME Corp");
    expect(trip.jobType).toBe("IMPORT");
    expect(trip.pickupAddress1).toBe("Trip Origin St 100");
    expect(trip.pickupPostal).toBe("333333");
    expect(trip.deliveryAddress1).toBe("Trip Dest Ave");
    expect(trip.deliveryAddress2).toBe("Suite 2");
    expect(trip.deliveryPostal).toBe("444444");
    expect(trip.originSummary).toContain("Trip Origin");
    expect(trip.destinationSummary).toContain("Trip Dest");
  });

  it("returns notes and driverEarningCents on each trip row", async () => {
    const prisma: any = {
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeActiveJobWithTrip()]),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    const result = await svc.listActiveByDriver(tenantId, driverUserId, {
      sortBy: "createdAt",
      sortDir: "asc",
    });
    const trip = result.data[0].trips?.[0] as any;
    expect(trip.notes).toBe("Handle with care");
    expect(trip.driverEarningCents).toBe(5000);
    expect(trip.earningLabelSnapshot).toBe("Linehaul");
    expect(trip.trailerNumber).toBe("TN99");
  });

  it("falls back to job pickup/delivery when trip route address lines are missing", async () => {
    const prisma: any = {
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          makeActiveJobWithTrip({
            originAddressLine1: null,
            originAddressLine2: null,
            originPostalCode: null,
            destinationAddressLine1: null,
            destinationAddressLine2: null,
            destinationPostalCode: null,
            originLabel: null,
            destinationLabel: null,
            driverEarningCents: null,
            earningLabelSnapshot: null,
            trailerNumber: null,
          }),
        ]),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    const result = await svc.listActiveByDriver(tenantId, driverUserId, {
      sortBy: "createdAt",
      sortDir: "asc",
    });
    const trip = result.data[0].trips?.[0] as any;
    expect(trip.pickupAddress1).toBe("Job Pickup Rd 1");
    expect(trip.pickupAddress2).toBe("Blk 1");
    expect(trip.pickupPostal).toBe("111111");
    expect(trip.deliveryAddress1).toBe("Job Del Rd");
    expect(trip.deliveryPostal).toBe("222222");
    expect(trip.originSummary).toBe("Job Pickup Rd 1");
    expect(trip.destinationSummary).toBe("Job Del Rd");
    expect(trip.driverEarningCents).toBeNull();
    expect(trip.earningLabelSnapshot).toBeNull();
    expect(trip.trailerNumber).toBeNull();
    expect(trip.notes).toBe("Handle with care");
  });
});
