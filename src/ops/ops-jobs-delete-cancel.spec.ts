import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { JobStatus, Role, TripStatus } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";

const DRAFT_TRIPS_ONLY_MSG =
  "This job can only be deleted while all trips are still draft. Cancel the job instead.";

describe("OpsJobsService job delete/cancel guards", () => {
  function makeTx() {
    return {
      driverWalletTransaction: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      tripPayoutLine: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      tripDocument: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      tripDocumentRequirement: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      trip: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      jobCharge: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      jobDocument: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      jobItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      job: { delete: jest.fn().mockResolvedValue({}) },
    };
  }

  function makeService(overrides?: Partial<any>) {
    const tx = makeTx();
    const prisma: any = {
      job: {
        findFirst: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "c1",
          internalRef: "WF-2026-04-0001-LCL",
          externalRef: null,
          jobType: "LCL",
          status: JobStatus.CANCELLED,
          invoiceReadyAt: null,
          notes: null,
          createdByUserId: "u1",
          createdAt: new Date(),
          updatedAt: new Date(),
          pickupDate: null,
          pickupAddress1: "A",
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress1: "B",
          deliveryAddress2: null,
          deliveryPostal: null,
          receiverName: "R",
          receiverPhone: "123",
          assignedDriverId: null,
          assignedAt: null,
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
          cancelledReason: "reason",
          cancelledAt: new Date(),
          customerCompany: { id: "c1", name: "ACME" },
          assignedDriver: null,
          createdBy: null,
          items: [],
          trips: [],
          documents: [],
          charges: [],
        }),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
      ...overrides,
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
    return { svc, prisma, tx };
  }

  function mockDeletableJob(
    prisma: any,
    trips: { id: string; status: TripStatus }[] = [],
  ) {
    prisma.job.findFirst.mockResolvedValue({
      id: "job1",
      status: JobStatus.ONGOING,
      startedAt: null,
      assignedDriverId: null,
      trips,
    });
  }

  it("delete job with zero trips succeeds", async () => {
    const { svc, prisma, tx } = makeService();
    mockDeletableJob(prisma);

    await expect(
      svc.delete("t1", "job1", { userId: "u1", role: Role.OPS }),
    ).resolves.toBeUndefined();

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.trip.deleteMany).not.toHaveBeenCalled();
    expect(tx.jobCharge.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", jobId: "job1" },
    });
    expect(tx.jobDocument.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", jobId: "job1" },
    });
    expect(tx.jobItem.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", jobId: "job1" },
    });
    expect(tx.job.delete).toHaveBeenCalledWith({ where: { id: "job1" } });
    expect(prisma.job.delete).not.toHaveBeenCalled();
  });

  it("delete job with only DRAFT trips succeeds and removes draft trip data", async () => {
    const { svc, prisma, tx } = makeService();
    mockDeletableJob(prisma, [
      { id: "trip1", status: TripStatus.DRAFT },
      { id: "trip2", status: TripStatus.DRAFT },
    ]);

    await expect(
      svc.delete("t1", "job1", { userId: "u1", role: Role.OPS }),
    ).resolves.toBeUndefined();

    expect(tx.driverWalletTransaction.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", tripId: { in: ["trip1", "trip2"] } },
    });
    expect(tx.tripPayoutLine.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", tripId: { in: ["trip1", "trip2"] } },
    });
    expect(tx.tripDocument.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", tripId: { in: ["trip1", "trip2"] } },
    });
    expect(tx.tripDocumentRequirement.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", tripId: { in: ["trip1", "trip2"] } },
    });
    expect(tx.trip.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", jobId: "job1" },
    });
    expect(tx.job.delete).toHaveBeenCalledWith({ where: { id: "job1" } });
  });

  it.each([
    TripStatus.PUBLISHED,
    TripStatus.ONGOING,
    TripStatus.COMPLETED,
    TripStatus.DONE,
    TripStatus.CANCELLED,
  ])("delete job with %s trip cannot be deleted", async (tripStatus) => {
    const { svc, prisma } = makeService();
    mockDeletableJob(prisma, [{ id: "trip1", status: tripStatus }]);

    await expect(
      svc.delete("t1", "job1", { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow(DRAFT_TRIPS_ONLY_MSG);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    TripStatus.DRAFT,
    TripStatus.PUBLISHED,
    TripStatus.ONGOING,
    TripStatus.COMPLETED,
    TripStatus.DONE,
    TripStatus.CANCELLED,
  ])("cancel job with %s trip fails", async (tripStatus) => {
    const { svc, prisma } = makeService();
    prisma.job.findFirst.mockResolvedValue({
      id: "job1",
      status: JobStatus.ONGOING,
      _count: { trips: 1 },
      _tripStatusForContextOnly: tripStatus,
    });

    await expect(
      svc.cancel(
        "t1",
        "job1",
        { reason: "x" },
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("This job has trips. Cancel trips individually from the Trips tab.");
  });

  it("cancel empty job still succeeds", async () => {
    const { svc, prisma } = makeService();
    prisma.job.findFirst.mockResolvedValue({
      id: "job1",
      status: JobStatus.ONGOING,
      _count: { trips: 0 },
    });

    await expect(
      svc.cancel("t1", "job1", { reason: "x" }, { userId: "u1", role: Role.OPS }),
    ).resolves.toBeTruthy();
  });

  it("tenant isolation enforced for delete/cancel", async () => {
    const { svc, prisma } = makeService();
    prisma.job.findFirst.mockResolvedValue(null);

    await expect(
      svc.delete("t1", "missing", { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.cancel("t1", "missing", { reason: "x" }, { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow(NotFoundException);
  });

  it("customer cannot delete/cancel jobs", async () => {
    const { svc } = makeService();
    await expect(
      svc.delete("t1", "job1", { userId: "u1", role: Role.CUSTOMER, customerCompanyId: "c1" }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      svc.cancel(
        "t1",
        "job1",
        { reason: "x" },
        { userId: "u1", role: Role.CUSTOMER, customerCompanyId: "c1" },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
