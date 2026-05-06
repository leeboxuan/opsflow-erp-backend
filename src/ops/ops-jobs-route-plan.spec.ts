import { BadRequestException } from "@nestjs/common";
import { JobStatus, TripStatus } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";

describe("OpsJobsService route planning", () => {
  function makeService(overrides?: Partial<any>) {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "c1",
          internalRef: "WF-2026-04-0002-IMP",
          status: JobStatus.ONGOING,
        }),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === "function") return cb(prisma);
        return Promise.all(cb);
      }),
      ...overrides,
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new OpsJobsService(prisma, audit, {} as any);
    return { svc, prisma, audit };
  }

  const accessUser = { userId: "u1", role: "OPS", customerCompanyId: null };

  it("suggestTripOrder includes only DRAFT/PUBLISHED and skips terminal/live statuses", async () => {
    const { svc, prisma } = makeService({
      trip: {
        findMany: jest.fn().mockResolvedValue([
          { id: "t-draft", status: TripStatus.DRAFT, tripSequence: 1, originLat: 1.3, originLng: 103.8, destinationLat: 1.31, destinationLng: 103.81 },
          { id: "t-pub", status: TripStatus.PUBLISHED, tripSequence: 2, originLat: 1.32, originLng: 103.82, destinationLat: 1.33, destinationLng: 103.83 },
          { id: "t-ongoing", status: TripStatus.ONGOING, tripSequence: 3, originLat: 1.34, originLng: 103.84, destinationLat: 1.35, destinationLng: 103.85 },
          { id: "t-done", status: TripStatus.DONE, tripSequence: 4, originLat: 1.36, originLng: 103.86, destinationLat: 1.37, destinationLng: 103.87 },
        ]),
      },
    });

    const res = await svc.suggestTripOrder("t1", "job1", {}, accessUser);
    expect(res.suggestedTripIdsInOrder).toEqual(["t-draft", "t-pub"]);
    expect(res.skippedTripIds.sort()).toEqual(["t-done", "t-ongoing"]);
    expect(prisma.job.findFirst).toHaveBeenCalledWith({ where: { id: "job1", tenantId: "t1" } });
  });

  it("suggestTripOrder returns warnings for missing coordinates", async () => {
    const { svc } = makeService({
      trip: {
        findMany: jest.fn().mockResolvedValue([
          { id: "t1", status: TripStatus.DRAFT, tripSequence: 1, originLat: null, originLng: null, destinationLat: null, destinationLng: null },
        ]),
      },
    });
    const res = await svc.suggestTripOrder("t1", "job1", {}, accessUser);
    expect(res.warnings.join(" ")).toContain("missing origin");
    expect(res.warnings.join(" ")).toContain("missing destination");
  });

  it("publishTripRoute applies order and publishes ready DRAFT trips", async () => {
    const { svc, prisma, audit } = makeService({
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "t-draft",
            status: TripStatus.DRAFT,
            tripSequence: 2,
            jobSequence: 2,
            assignedDriverUserId: "d1",
            driverId: "drv1",
            vehicleId: "v1",
            fleetVehicleId: null,
            driverEarningCents: 1000,
          },
          {
            id: "t-pub",
            status: TripStatus.PUBLISHED,
            tripSequence: 1,
            jobSequence: 1,
            assignedDriverUserId: "d1",
            driverId: "drv1",
            vehicleId: "v1",
            fleetVehicleId: null,
            driverEarningCents: 1000,
          },
          {
            id: "t-done",
            status: TripStatus.DONE,
            tripSequence: 3,
            jobSequence: 3,
            assignedDriverUserId: "d1",
            driverId: "drv1",
            vehicleId: "v1",
            fleetVehicleId: null,
            driverEarningCents: 1000,
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await svc.publishTripRoute(
      "t1",
      "job1",
      { tripIdsInOrder: ["t-draft", "t-pub"], publishTripIds: ["t-draft", "t-pub", "t-done"] },
      accessUser,
    );

    expect(res.ok).toBe(true);
    expect(res.orderedTripIds).toEqual(["t-draft", "t-pub"]);
    expect(res.publishedTripIds).toEqual(["t-draft"]);
    expect(res.alreadyPublishedTripIds).toEqual(["t-pub"]);
    expect(res.skippedTripIds).toEqual(["t-done"]);
    expect(prisma.trip.update).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "TRIP_ROUTE_PUBLISH",
      "JOB",
      "job1",
      expect.any(Object),
      "u1",
    );
  });

  it("publishTripRoute blocks draft trip without driver assignment", async () => {
    const { svc } = makeService({
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "t-draft",
            status: TripStatus.DRAFT,
            tripSequence: 1,
            jobSequence: 1,
            assignedDriverUserId: null,
            driverId: null,
            vehicleId: null,
            fleetVehicleId: null,
            driverEarningCents: null,
          },
        ]),
      },
    });

    await expect(
      svc.publishTripRoute("t1", "job1", {}, accessUser),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("publishTripRoute blocks manual payout missing amount via readiness check", async () => {
    const { svc } = makeService({
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "t-draft",
            status: TripStatus.DRAFT,
            tripSequence: 1,
            jobSequence: 1,
            assignedDriverUserId: "d1",
            driverId: "drv1",
            vehicleId: "v1",
            fleetVehicleId: null,
            driverEarningCents: null,
          },
        ]),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          { id: "line-1", label: "Manual", isManual: true, quantity: 1, amountCents: null, totalCents: 1000 },
        ]),
      },
    });

    await expect(
      svc.publishTripRoute("t1", "job1", {}, accessUser),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("customer role cannot mutate route planning endpoints", async () => {
    const { svc } = makeService();
    const customerUser = { userId: "u2", role: "CUSTOMER", customerCompanyId: "c1" };
    await expect(
      svc.suggestTripOrder("t1", "job1", {}, customerUser),
    ).rejects.toThrow("read-only");
    await expect(
      svc.publishTripRoute("t1", "job1", {}, customerUser),
    ).rejects.toThrow("read-only");
  });
});
