import { TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.listActiveByDriver runSheet", () => {
  const tenantId = "tenant-1";
  const driverUserId = "driver-1";

  function makeActiveJob() {
    return {
      id: "job1",
      tenantId,
      customerCompanyId: "c1",
      internalRef: "JOB-INT-1",
      externalRef: null,
      jobType: "IMPORT",
      status: "ONGOING",
      invoiceReadyAt: null,
      notes: "note",
      pickupDate: new Date("2026-05-04T00:00:00.000Z"),
      pickupAddress1: "Pick A",
      pickupAddress2: null,
      pickupPostal: null,
      pickupContactName: null,
      pickupContactPhone: null,
      deliveryAddress1: "Drop B",
      deliveryAddress2: null,
      deliveryPostal: null,
      receiverName: "R",
      receiverPhone: "1",
      assignedDriverId: null,
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
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      items: [],
      documents: [],
      customerCompany: { id: "c1", name: "Customer A" },
      trips: [],
    };
  }

  function makeRunTrip(overrides: Record<string, any> = {}) {
    return {
      id: "trip1",
      tenantId,
      jobId: "job1",
      assignedDriverUserId: driverUserId,
      status: TripStatus.PUBLISHED,
      pendingState: "NONE",
      tripSequence: 1,
      jobSequence: 1,
      title: "Leg 1",
      displayTitle: null,
      plannedStartAt: new Date("2026-05-04T01:00:00.000Z"),
      startedAt: null,
      closedAt: null,
      updatedAt: new Date("2026-05-04T02:00:00.000Z"),
      createdAt: new Date("2026-05-04T00:30:00.000Z"),
      trailerNumber: null,
      routeVersion: 3,
      originLabel: "Origin A",
      originAddressLine1: null,
      originAddressLine2: null,
      originPostalCode: null,
      destinationLabel: "Destination B",
      destinationAddressLine1: null,
      destinationAddressLine2: null,
      destinationPostalCode: null,
      driverEarningCents: 2500,
      earningLabelSnapshot: "Linehaul",
      job: {
        id: "job1",
        internalRef: "JOB-INT-1",
        jobType: "IMPORT",
        notes: "note",
        pickupAddress1: "Pick A",
        pickupAddress2: null,
        pickupPostal: null,
        deliveryAddress1: "Drop B",
        deliveryAddress2: null,
        deliveryPostal: null,
        customerCompany: { name: "Customer A" },
      },
      ...overrides,
    };
  }

  function makeService(runTrips: any[]) {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeActiveJob()]),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: driverUserId, name: "Driver A" }) },
      trip: { findMany: jest.fn().mockResolvedValue(runTrips) },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    return { svc, prisma };
  }

  it("includes completed trip under an ONGOING job and excludes draft/cancelled from run sheet", async () => {
    const runTrips = [
      makeRunTrip({ id: "done-trip", status: TripStatus.COMPLETED, closedAt: new Date("2026-05-04T03:00:00.000Z") }),
      makeRunTrip({ id: "open-trip", status: TripStatus.PUBLISHED, tripSequence: 2 }),
    ];
    const { svc } = makeService(runTrips);
    const res = await svc.listActiveByDriver(tenantId, driverUserId, {
      date: "2026-05-04",
      sortBy: "createdAt",
    });

    expect(res.runSheet?.totalTrips).toBe(2);
    expect(res.runSheet?.completedTrips).toBe(1);
    expect(res.runSheet?.trips.map((t: any) => t.tripId)).toEqual(["done-trip", "open-trip"]);
    expect(res.runSheet?.trips.find((t: any) => t.tripId === "done-trip")?.closedAt).toBeInstanceOf(Date);
  });

  it("orders by sequence and sets current/next actionability with sequence lock", async () => {
    const runTrips = [
      makeRunTrip({ id: "seq-2", tripSequence: 2, status: TripStatus.PUBLISHED }),
      makeRunTrip({ id: "seq-1", tripSequence: 1, status: TripStatus.ONGOING, startedAt: new Date("2026-05-04T01:00:00.000Z") }),
      makeRunTrip({ id: "seq-3", tripSequence: 3, status: TripStatus.PUBLISHED }),
    ];
    const { svc } = makeService(runTrips);
    const res = await svc.listActiveByDriver(tenantId, driverUserId, {
      date: "2026-05-04",
      sortBy: "createdAt",
    });
    const ids = res.runSheet?.trips.map((t: any) => t.tripId);
    expect(ids).toEqual(["seq-1", "seq-2", "seq-3"]);
    expect(res.runSheet?.currentTripId).toBe("seq-1");
    expect(res.runSheet?.nextTripId).toBe("seq-1");
    expect(res.runSheet?.trips.find((t: any) => t.tripId === "seq-1")?.isCurrent).toBe(true);
    expect(res.runSheet?.trips.find((t: any) => t.tripId === "seq-2")?.isLockedBySequence).toBe(true);
    expect(res.runSheet?.trips.find((t: any) => t.tripId === "seq-3")?.isLockedBySequence).toBe(true);
  });

  it("falls back to plannedStartAt then createdAt when sequence is missing", async () => {
    const runTrips = [
      makeRunTrip({ id: "no-seq-late", tripSequence: null, jobSequence: null, plannedStartAt: new Date("2026-05-04T03:00:00.000Z"), createdAt: new Date("2026-05-04T00:03:00.000Z") }),
      makeRunTrip({ id: "no-seq-early", tripSequence: null, jobSequence: null, plannedStartAt: new Date("2026-05-04T01:00:00.000Z"), createdAt: new Date("2026-05-04T00:02:00.000Z") }),
      makeRunTrip({ id: "no-seq-no-plan", tripSequence: null, jobSequence: null, plannedStartAt: null, createdAt: new Date("2026-05-04T00:01:00.000Z") }),
    ];
    const { svc } = makeService(runTrips);
    const res = await svc.listActiveByDriver(tenantId, driverUserId, {
      date: "2026-05-04",
      sortBy: "createdAt",
    });
    expect(res.runSheet?.trips.map((t: any) => t.tripId)).toEqual([
      "no-seq-early",
      "no-seq-late",
      "no-seq-no-plan",
    ]);
  });

  it("selects first publishable trip as nextTripId when nothing is ongoing", async () => {
    const runTrips = [
      makeRunTrip({ id: "done-1", tripSequence: 1, status: TripStatus.DONE, closedAt: new Date("2026-05-04T01:00:00.000Z") }),
      makeRunTrip({ id: "pub-2", tripSequence: 2, status: TripStatus.PUBLISHED }),
      makeRunTrip({ id: "pub-3", tripSequence: 3, status: TripStatus.PUBLISHED }),
    ];
    const { svc } = makeService(runTrips);
    const res = await svc.listActiveByDriver(tenantId, driverUserId, {
      date: "2026-05-04",
      sortBy: "createdAt",
    });
    expect(res.runSheet?.currentTripId).toBeNull();
    expect(res.runSheet?.nextTripId).toBe("pub-2");
    expect(res.runSheet?.trips.find((t: any) => t.tripId === "pub-2")?.isNextActionable).toBe(true);
  });

  it("queries run sheet trips with non-cancelled status and assigned driver", async () => {
    const { svc, prisma } = makeService([makeRunTrip()]);
    await svc.listActiveByDriver(tenantId, driverUserId, {
      date: "2026-05-04",
      sortBy: "createdAt",
    });
    const where = prisma.trip.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(tenantId);
    expect(where.assignedDriverUserId).toBe(driverUserId);
    expect(where.status.notIn).toEqual([TripStatus.DRAFT, TripStatus.CANCELLED]);
  });
});
