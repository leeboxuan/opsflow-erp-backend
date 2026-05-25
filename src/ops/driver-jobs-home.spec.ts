import { JobStatus, TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.getDriverHome", () => {
  const tenantId = "tenant-1";
  const driver1 = "driver-1";
  const driver2 = "driver-2";
  const date = "2026-05-25";

  const jobContext = {
    id: "job-1",
    internalRef: "WF-0010-LCL",
    pickupDate: new Date("2026-05-25T00:00:00.000Z"),
    pickupAddress1: "Pickup St",
    pickupAddress2: null,
    pickupPostal: "111111",
    deliveryAddress1: "Delivery St",
    deliveryAddress2: null,
    deliveryPostal: "222222",
    notes: null,
    jobType: "LCL",
    customerCompany: { name: "ACME" },
  };

  function tripRow(overrides: Record<string, any> = {}) {
    return {
      id: "trip-today",
      jobId: "job-1",
      jobSequence: 1,
      tripSequence: 1,
      assignedDriverUserId: driver1,
      status: TripStatus.PUBLISHED,
      pendingState: "NONE",
      plannedStartAt: new Date("2026-05-25T08:00:00.000Z"),
      startedAt: null,
      closedAt: null,
      title: "Today leg",
      displayTitle: null,
      jobTripTemplate: null,
      trailerNumber: null,
      originLabel: "Origin",
      originAddressLine1: "Origin",
      destinationLabel: "Dest",
      destinationAddressLine1: "Dest",
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      job: jobContext,
      ...overrides,
    };
  }

  function makeService(opts: {
    runSheetTrips?: any[];
    activeAssignedTrips?: any[];
  }) {
    const activeAssignedTrips = opts.activeAssignedTrips ?? opts.runSheetTrips ?? [tripRow()];
    const runSheetTrips = opts.runSheetTrips ?? activeAssignedTrips.filter((t) => {
      const at = t.plannedStartAt ? new Date(t.plannedStartAt).toISOString() : "";
      return at.startsWith("2026-05-25");
    });

    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: driver1, name: "Driver One" }) },
      trip: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(runSheetTrips)
          .mockResolvedValue(activeAssignedTrips),
      },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    return { svc, prisma };
  }

  function allTripIds(res: Awaited<ReturnType<DriverJobsService["getDriverHome"]>>) {
    return [
      ...res.today.trips.map((t) => t.tripId),
      ...res.assignedOutsideToday.needsAttention.map((t) => t.tripId),
      ...res.assignedOutsideToday.upcoming.map((t) => t.tripId),
      ...res.assignedOutsideToday.unscheduled.map((t) => t.tripId),
    ];
  }

  it("puts today's trip in today.trips only, not in assignedOutsideToday", async () => {
    const today = tripRow({ id: "trip-today" });
    const { svc } = makeService({
      runSheetTrips: [today],
      activeAssignedTrips: [today],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.date).toBe(date);
    expect(res.today.trips.map((t) => t.tripId)).toEqual(["trip-today"]);
    expect(res.assignedOutsideToday.needsAttention).toHaveLength(0);
    expect(res.assignedOutsideToday.upcoming).toHaveLength(0);
    expect(res.assignedOutsideToday.unscheduled).toHaveLength(0);
  });

  it("splits T01 overdue, T02 today, and T03 upcoming on one job (trip-centric grouping)", async () => {
    const t01 = tripRow({
      id: "trip-t01",
      tripSequence: 1,
      status: TripStatus.PUBLISHED,
      plannedStartAt: new Date("2026-05-22T00:00:00.000Z"),
      title: "WF-0010-LCL-T01",
    });
    const t02 = tripRow({
      id: "trip-t02",
      tripSequence: 2,
      status: TripStatus.ONGOING,
      plannedStartAt: new Date("2026-05-25T08:00:00.000Z"),
      title: "WF-0010-LCL-T02",
    });
    const t03 = tripRow({
      id: "trip-t03",
      tripSequence: 3,
      status: TripStatus.PUBLISHED,
      plannedStartAt: new Date("2026-05-26T00:00:00.000Z"),
      title: "WF-0010-LCL-T03",
    });

    const { svc } = makeService({
      runSheetTrips: [t02],
      activeAssignedTrips: [t01, t02, t03],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.today.trips.map((t) => t.tripId)).toEqual(["trip-t02"]);
    expect(res.today.trips.map((t) => t.tripId)).not.toContain("trip-t01");
    expect(res.today.trips.map((t) => t.tripId)).not.toContain("trip-t03");
    expect(res.assignedOutsideToday.needsAttention.map((t) => t.tripId)).toEqual(["trip-t01"]);
    expect(res.assignedOutsideToday.upcoming.map((t) => t.tripId)).toEqual(["trip-t03"]);
    expect(res.assignedOutsideToday.unscheduled).toHaveLength(0);

    const ids = allTripIds(res);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("classifies a future trip as upcoming (tenant timezone calendar day)", async () => {
    const future = tripRow({
      id: "trip-future",
      plannedStartAt: new Date("2026-05-26T01:00:00.000Z"),
      job: { ...jobContext, pickupDate: new Date("2026-05-26T00:00:00.000Z") },
    });
    const { svc } = makeService({
      runSheetTrips: [],
      activeAssignedTrips: [future],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.assignedOutsideToday.upcoming.map((t) => t.tripId)).toEqual(["trip-future"]);
    expect(res.assignedOutsideToday.needsAttention).toHaveLength(0);
    expect(res.today.trips).toHaveLength(0);
  });

  it("classifies an overdue trip as needsAttention", async () => {
    const overdue = tripRow({
      id: "trip-overdue",
      plannedStartAt: new Date("2026-05-24T10:00:00.000Z"),
      job: { ...jobContext, pickupDate: new Date("2026-05-24T00:00:00.000Z") },
    });
    const { svc } = makeService({
      runSheetTrips: [],
      activeAssignedTrips: [overdue],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.assignedOutsideToday.needsAttention.map((t) => t.tripId)).toEqual([
      "trip-overdue",
    ]);
    expect(res.assignedOutsideToday.upcoming).toHaveLength(0);
  });

  it("classifies active trips with no date as unscheduled", async () => {
    const unscheduled = tripRow({
      id: "trip-none",
      plannedStartAt: null,
      job: { ...jobContext, pickupDate: null },
    });
    const { svc } = makeService({
      runSheetTrips: [],
      activeAssignedTrips: [unscheduled],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.assignedOutsideToday.unscheduled.map((t) => t.tripId)).toEqual(["trip-none"]);
  });

  it("loads active assigned trips with PUBLISHED/ONGOING only (not COMPLETED/DONE)", async () => {
    const { svc, prisma } = makeService({
      runSheetTrips: [],
      activeAssignedTrips: [],
    });

    await svc.getDriverHome(tenantId, driver1, date);

    const activeCall = prisma.trip.findMany.mock.calls[1][0];
    expect(activeCall.where.status).toEqual({
      in: [TripStatus.PUBLISHED, TripStatus.ONGOING],
    });
    expect(activeCall.where.assignedDriverUserId).toBe(driver1);
  });

  it("does not return other drivers' trips in active assigned query", async () => {
    const { svc, prisma } = makeService({
      runSheetTrips: [],
      activeAssignedTrips: [],
    });

    await svc.getDriverHome(tenantId, driver1, date);

    expect(prisma.trip.findMany.mock.calls[1][0].where.assignedDriverUserId).toBe(driver1);
    expect(prisma.trip.findMany.mock.calls[1][0].where.assignedDriverUserId).not.toBe(driver2);
  });

  it("includes runSheet summary fields on today", async () => {
    const open = tripRow({ id: "trip-open", status: TripStatus.PUBLISHED });
    const done = tripRow({
      id: "trip-done",
      status: TripStatus.COMPLETED,
      closedAt: new Date("2026-05-25T12:00:00.000Z"),
      tripSequence: 2,
    });
    const { svc } = makeService({
      runSheetTrips: [done, open],
      activeAssignedTrips: [open],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.today.runSheet).not.toBeNull();
    expect(res.today.summary.completed).toBe(1);
    expect(res.today.summary.total).toBe(2);
  });

  it("returns slim trip cards without signed URLs or cargo items", async () => {
    const today = tripRow({ id: "trip-a" });
    const future = tripRow({
      id: "trip-b",
      plannedStartAt: new Date("2026-05-26T08:00:00.000Z"),
    });
    const { svc } = makeService({
      runSheetTrips: [today],
      activeAssignedTrips: [today, future],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);
    const serialized = JSON.stringify(res);

    expect(serialized).not.toMatch(/signedUrl|downloadUrl|previewUrl/i);
    expect(serialized).not.toContain("items");
    expect(res.today.trips[0]).toMatchObject({
      tripId: "trip-a",
      jobInternalRef: "WF-0010-LCL",
      customerName: "ACME",
    });
  });
});
