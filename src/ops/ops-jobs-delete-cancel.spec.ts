import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { JobStatus, Role, TripStatus } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";

describe("OpsJobsService job delete/cancel guards", () => {
  function makeService(overrides?: Partial<any>) {
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
      ...overrides,
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
    return { svc, prisma };
  }

  it("delete job with zero trips succeeds", async () => {
    const { svc, prisma } = makeService();
    prisma.job.findFirst.mockResolvedValue({
      id: "job1",
      status: JobStatus.ONGOING,
      startedAt: null,
      assignedDriverId: null,
      _count: { trips: 0 },
    });

    await expect(
      svc.delete("t1", "job1", { userId: "u1", role: Role.OPS }),
    ).resolves.toBeUndefined();
    expect(prisma.job.delete).toHaveBeenCalledWith({ where: { id: "job1" } });
  });

  it.each([
    TripStatus.DRAFT,
    TripStatus.PUBLISHED,
    TripStatus.ONGOING,
    TripStatus.COMPLETED,
    TripStatus.DONE,
    TripStatus.CANCELLED,
  ])("delete job with %s trip fails", async (tripStatus) => {
    const { svc, prisma } = makeService();
    prisma.job.findFirst.mockResolvedValue({
      id: "job1",
      status: JobStatus.ONGOING,
      startedAt: null,
      assignedDriverId: null,
      _count: { trips: 1 },
      _tripStatusForContextOnly: tripStatus,
    });

    await expect(
      svc.delete("t1", "job1", { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow("This job has trips. Delete or cancel the trips before deleting the job.");
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
