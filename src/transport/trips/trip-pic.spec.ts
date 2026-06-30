import { JobStatus, JobType, Role, TripStatus } from "@prisma/client";
import { DriverJobsService } from "../driver-app/driver-jobs.service";
import { OpsJobsService } from "../jobs/ops-jobs.service";

describe("Trip PIC fields", () => {
  it("patchTrip can set and clear tripPICName/tripPICContact/containerNumber/shipping refs without touching job PIC", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: TripStatus.DRAFT,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      job: { update: jest.fn() },
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      {
        tripPICName: "  John Tan  ",
        tripPICContact: "  +65 9876 5432  ",
        containerNumber: "  CONT-7788 ",
        carrier: "  MAERSK ",
        shipper: "  ACME ",
        vessel: "  VESSEL-A ",
      } as any,
      { userId: "u1", role: Role.OPS, customerCompanyId: null },
    );
    expect(prisma.trip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "trip1" },
        data: expect.objectContaining({
          tripPICName: "John Tan",
          tripPICContact: "+65 9876 5432",
          containerNumber: "CONT-7788",
          carrier: "MAERSK",
          shipper: "ACME",
          vessel: "VESSEL-A",
        }),
      }),
    );

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      {
        tripPICName: null,
        tripPICContact: "",
        containerNumber: " ",
        carrier: "",
        shipper: " ",
        vessel: "",
      } as any,
      { userId: "u1", role: Role.OPS, customerCompanyId: null },
    );
    expect(prisma.trip.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tripPICName: null,
          tripPICContact: null,
          containerNumber: null,
          carrier: null,
          shipper: null,
          vessel: null,
        }),
      }),
    );
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it("trip patch clears containerNumber/carrier/shipper/vessel on LCL trips without requiring them on create", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: TripStatus.DRAFT,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({
      id: "job1",
      jobType: JobType.LCL,
    } as any);

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      {
        containerNumber: null,
        carrier: null,
        shipper: null,
        vessel: null,
      } as any,
      { userId: "u1", role: Role.OPS, customerCompanyId: null },
    );

    expect(prisma.trip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerNumber: null,
          carrier: null,
          shipper: null,
          vessel: null,
        }),
      }),
    );
  });

  it("job detail trip list returns tripPICName/tripPICContact/container and shipping refs", async () => {
    const prisma: any = {
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "driver-1", user: { name: "Driver One", email: "d@example.com" } },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job1",
            tenantId: "t1",
            customerCompanyId: "c1",
            internalRef: "WF-2026-04-0002-IMP",
            externalRef: null,
            jobType: JobType.IMPORT,
            status: JobStatus.ONGOING,
            pickupDate: new Date("2026-05-01T00:00:00.000Z"),
            createdAt: new Date(),
            updatedAt: new Date(),
            customerCompany: { name: "ACME" },
            _count: { items: 0, trips: 1, documents: 0 },
            trips: [{ assignedDriverUserId: "driver-1" }],
          },
        ]),
      },
    };
    const svc = new OpsJobsService(prisma, { log: jest.fn() } as any, {} as any);
    const res = await svc.list("t1", {} as any, { role: Role.OPS, customerCompanyId: null });
    expect(res.data[0]).toEqual(
      expect.objectContaining({
        id: "job1",
        tripCount: 1,
        itemCount: 0,
        assignedDriverId: "driver-1",
      }),
    );
    expect(res.data[0]).not.toHaveProperty("trips");
  });

  it("driver trip detail returns tripPICName/tripPICContact/container and shipping refs", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          jobId: "job1",
          tenantId: "t1",
          status: TripStatus.PUBLISHED,
          assignedDriverUserId: "d1",
          tripSequence: 1,
          jobSequence: 1,
          title: "Trip",
          displayTitle: "Trip",
          plannedStartAt: null,
          originLabel: null,
          destinationLabel: null,
          tripPICName: "Site PIC",
          tripPICContact: "888",
          containerNumber: "CONT-DRIVER",
          carrier: "Carrier D",
          shipper: "Shipper D",
          vessel: "Vessel D",
          trailerLastLocationCode: null,
          trailerParkedAt: null,
          trailerParkingLat: null,
          trailerParkingLng: null,
          trailerNumber: null,
          job: {
            id: "job1",
            internalRef: "WF-2026-04-0002-IMP",
            externalRef: null,
            jobType: JobType.IMPORT,
            status: JobStatus.ONGOING,
            customerCompany: { name: "ACME" },
            items: [],
          },
          documents: [],
        }),
      },
      masterTrailerLocation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, {} as any);
    const res = await svc.getTripDetailForDriver("t1", "trip1", "d1");
    expect(res.tripPICName).toBe("Site PIC");
    expect(res.tripPICContact).toBe("888");
    expect(res.containerNumber).toBe("CONT-DRIVER");
    expect(res.carrier).toBe("Carrier D");
    expect(res.shipper).toBe("Shipper D");
    expect(res.vessel).toBe("Vessel D");
  });
});
