import { DriverJobsService } from "./driver-jobs.service";

describe("driver jobs published-trip visibility", () => {
  it("getOneForDriver requests only published trips (non-draft)", async () => {
    const prisma: any = {
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
      "Missing required trip documents: DELIVERY_DO, POD_SIGNATURE",
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
