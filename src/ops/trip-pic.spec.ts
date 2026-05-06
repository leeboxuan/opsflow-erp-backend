import { JobStatus, JobType, Role, TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";
import { OpsJobsService } from "./ops-jobs.service";

describe("Trip PIC fields", () => {
  it("patchTrip can set and clear tripPICName/tripPICContact without touching job PIC", async () => {
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
      { tripPICName: "  John Tan  ", tripPICContact: "  +65 9876 5432  " } as any,
      { userId: "u1", role: Role.OPS, customerCompanyId: null },
    );
    expect(prisma.trip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "trip1" },
        data: expect.objectContaining({
          tripPICName: "John Tan",
          tripPICContact: "+65 9876 5432",
        }),
      }),
    );

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      { tripPICName: null, tripPICContact: "" } as any,
      { userId: "u1", role: Role.OPS, customerCompanyId: null },
    );
    expect(prisma.trip.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tripPICName: null,
          tripPICContact: null,
        }),
      }),
    );
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it("job detail trip list returns tripPICName/tripPICContact", async () => {
    const prisma: any = {
      $transaction: jest.fn().mockResolvedValue([
        1,
        [{
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "c1",
          customerCompany: { id: "c1", name: "ACME" },
          internalRef: "WF-2026-04-0002-IMP",
          externalRef: null,
          jobType: JobType.IMPORT,
          status: JobStatus.ONGOING,
          pickupDate: new Date("2026-05-01T00:00:00.000Z"),
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "Job PIC",
          receiverPhone: "123",
          createdAt: new Date(),
          updatedAt: new Date(),
          trips: [{
            id: "trip1",
            createdAt: new Date(),
            assignedDriverUserId: null,
            jobSequence: 1,
            tripSequence: 1,
            jobTripTemplate: null,
            title: "Trip 1",
            status: TripStatus.PUBLISHED,
            plannedStartAt: null,
            startedAt: null,
            closedAt: null,
            trailerNumber: null,
            trailerLastLocationCode: null,
            driverEarningCents: null,
            earningLabelSnapshot: null,
            earningRateMasterId: null,
            tripPICName: "Ops PIC",
            tripPICContact: "999",
          }],
          items: [],
          documents: [],
          assignedDriver: null,
          createdBy: null,
        }],
      ]),
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const svc = new OpsJobsService(prisma, { log: jest.fn() } as any, {} as any);
    const res = await svc.list("t1", {} as any, { role: Role.OPS, customerCompanyId: null });
    expect(res.data[0].trips?.[0]).toEqual(
      expect.objectContaining({
        tripPICName: "Ops PIC",
        tripPICContact: "999",
      }),
    );
  });

  it("driver trip detail returns tripPICName/tripPICContact", async () => {
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
  });
});
