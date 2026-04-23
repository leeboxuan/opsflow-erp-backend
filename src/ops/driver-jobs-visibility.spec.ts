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
          status: "Assigned",
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
      { trips: { some: { status: { not: "Draft" } } } },
    ]);
    expect(args.include.trips.where).toEqual({ status: { not: "Draft" } });
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
          status: "InProgress",
          documents: [],
        }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "InTransit",
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
