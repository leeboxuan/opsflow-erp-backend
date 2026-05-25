import { JobStatus, TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";
import { JOB_DOCUMENT_MOBILE_SELECT } from "./driver-mobile-document.select";

describe("DriverJobsService.getDriverHome", () => {
  const tenantId = "tenant-1";
  const driver1 = "driver-1";
  const driver2 = "driver-2";
  const date = "2026-05-25";

  function baseJob(trips: any[]) {
    return {
      id: "job-1",
      tenantId,
      customerCompanyId: "c1",
      internalRef: "JOB-1",
      externalRef: null,
      jobType: "LCL",
      status: JobStatus.ONGOING,
      invoiceReadyAt: null,
      notes: null,
      pickupDate: new Date("2026-05-25T00:00:00.000Z"),
      pickupAddress1: "Pickup St",
      pickupAddress2: null,
      pickupPostal: "111111",
      pickupContactName: null,
      pickupContactPhone: null,
      deliveryAddress1: "Delivery St",
      deliveryAddress2: null,
      deliveryPostal: "222222",
      receiverName: "Recv",
      receiverPhone: "90000000",
      assignedDriver: { id: driver1, name: "Driver One" },
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
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:00:00.000Z"),
      customerCompany: { id: "c1", name: "ACME" },
      documents: [],
      trips,
    };
  }

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
      tripPICName: null,
      tripPICContact: null,
      containerNumber: null,
      carrier: null,
      shipper: null,
      vessel: null,
      trailerNumber: null,
      jobTripTemplate: null,
      driverEarningCents: 1000,
      earningLabelSnapshot: "Flat",
      earningRateMasterId: null,
      completionRuleJson: null,
      originLabel: "Origin",
      originAddressLine1: "Origin",
      destinationLabel: "Dest",
      destinationAddressLine1: "Dest",
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      ...overrides,
    };
  }

  function outsideTrip(overrides: Record<string, any> = {}) {
    return {
      id: "trip-outside",
      jobId: "job-1",
      jobSequence: 1,
      tripSequence: 2,
      assignedDriverUserId: driver1,
      status: TripStatus.PUBLISHED,
      pendingState: "NONE",
      plannedStartAt: new Date("2026-05-26T08:00:00.000Z"),
      startedAt: null,
      closedAt: null,
      title: "Outside",
      displayTitle: null,
      jobTripTemplate: null,
      trailerNumber: null,
      originLabel: "O",
      originAddressLine1: "O",
      destinationLabel: "D",
      destinationAddressLine1: "D",
      job: {
        id: "job-1",
        internalRef: "JOB-1",
        pickupDate: new Date("2026-05-26T00:00:00.000Z"),
        pickupAddress1: "Pickup St",
        pickupAddress2: null,
        pickupPostal: "111111",
        deliveryAddress1: "Delivery St",
        deliveryAddress2: null,
        deliveryPostal: "222222",
        notes: null,
        jobType: "LCL",
        customerCompany: { name: "ACME" },
      },
      ...overrides,
    };
  }

  function makeService(opts: {
    todayJobs?: any[];
    runSheetTrips?: any[];
    outsideTrips?: any[];
  }) {
    const todayJobs = opts.todayJobs ?? [baseJob([tripRow()])];
    const runSheetTrips = opts.runSheetTrips ?? [tripRow()];
    const outsideTrips = opts.outsideTrips ?? [];

    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      $queryRaw: jest.fn().mockResolvedValue(todayJobs.map((j) => ({ id: j.id }))),
      job: {
        count: jest.fn().mockResolvedValue(todayJobs.length),
        findMany: jest.fn().mockResolvedValue(todayJobs),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: driver1, name: "Driver One" }) },
      trip: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(runSheetTrips)
          .mockResolvedValue(outsideTrips),
      },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    return { svc, prisma };
  }

  it("puts today's trip in today.trips only, not in assignedOutsideToday", async () => {
    const today = tripRow({ id: "trip-today" });
    const { svc } = makeService({
      todayJobs: [baseJob([today])],
      runSheetTrips: [today],
      outsideTrips: [],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.date).toBe(date);
    expect(res.today.trips.map((t) => t.tripId)).toEqual(["trip-today"]);
    const outsideIds = [
      ...res.assignedOutsideToday.needsAttention,
      ...res.assignedOutsideToday.upcoming,
      ...res.assignedOutsideToday.unscheduled,
    ].map((t) => t.tripId);
    expect(outsideIds).not.toContain("trip-today");
  });

  it("classifies a future trip as upcoming (tenant timezone calendar day)", async () => {
    const future = outsideTrip({
      id: "trip-future",
      plannedStartAt: new Date("2026-05-26T01:00:00.000Z"),
      job: {
        ...outsideTrip().job,
        pickupDate: new Date("2026-05-26T00:00:00.000Z"),
      },
    });
    const { svc } = makeService({
      todayJobs: [],
      runSheetTrips: [],
      outsideTrips: [future],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.assignedOutsideToday.upcoming.map((t) => t.tripId)).toEqual(["trip-future"]);
    expect(res.assignedOutsideToday.needsAttention).toHaveLength(0);
  });

  it("classifies an overdue trip as needsAttention", async () => {
    const overdue = outsideTrip({
      id: "trip-overdue",
      plannedStartAt: new Date("2026-05-24T10:00:00.000Z"),
      job: {
        ...outsideTrip().job,
        pickupDate: new Date("2026-05-24T00:00:00.000Z"),
      },
    });
    const { svc } = makeService({
      todayJobs: [],
      runSheetTrips: [],
      outsideTrips: [overdue],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.assignedOutsideToday.needsAttention.map((t) => t.tripId)).toEqual([
      "trip-overdue",
    ]);
    expect(res.assignedOutsideToday.upcoming).toHaveLength(0);
  });

  it("classifies active trips with no date as unscheduled", async () => {
    const unscheduled = outsideTrip({
      id: "trip-none",
      plannedStartAt: null,
      job: { ...outsideTrip().job, pickupDate: null },
    });
    const { svc } = makeService({
      todayJobs: [],
      runSheetTrips: [],
      outsideTrips: [unscheduled],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.assignedOutsideToday.unscheduled.map((t) => t.tripId)).toEqual(["trip-none"]);
  });

  it("excludes COMPLETED/DONE from outside-today query filter", async () => {
    const { svc, prisma } = makeService({ todayJobs: [], runSheetTrips: [], outsideTrips: [] });

    await svc.getDriverHome(tenantId, driver1, date);

    const outsideCall = prisma.trip.findMany.mock.calls[1][0];
    expect(outsideCall.where.status).toEqual({
      in: [TripStatus.PUBLISHED, TripStatus.ONGOING],
    });
    expect(outsideCall.where.assignedDriverUserId).toBe(driver1);
  });

  it("does not return other drivers' trips in outside-today query", async () => {
    const { svc, prisma } = makeService({ todayJobs: [], runSheetTrips: [], outsideTrips: [] });

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
      todayJobs: [baseJob([open])],
      runSheetTrips: [done, open],
      outsideTrips: [],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);

    expect(res.today.runSheet).not.toBeNull();
    expect(res.today.summary.completed).toBe(1);
    expect(res.today.summary.total).toBe(2);
  });

  it("uses JobDocument-only select when loading jobs (avoids Prisma validation on home)", async () => {
    const { svc, prisma } = makeService({
      todayJobs: [baseJob([tripRow({ id: "trip-a" })])],
      runSheetTrips: [tripRow({ id: "trip-a" })],
      outsideTrips: [],
    });

    await svc.getDriverHome(tenantId, driver1, date);

    const documentsInclude = prisma.job.findMany.mock.calls[0][0].include.documents;
    expect(documentsInclude.select).toEqual(JOB_DOCUMENT_MOBILE_SELECT);
    expect(documentsInclude.select).not.toHaveProperty("requiresSignature");
  });

  it("succeeds with QUOTATION job document and returns metadata without signed URLs via active list path", async () => {
    const quotationDoc = {
      id: "doc-q",
      type: "QUOTATION",
      originalName: "quote.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      storageKey: "tenant/jobs/job-1/quote.pdf",
      isActive: true,
      jobId: "job-1",
      uploadedByUserId: "u1",
      uploadedByNameSnapshot: "Ops User",
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:00:00.000Z"),
      uploadedBy: { id: "u1", name: "Ops User", displayName: null, email: "ops@test.com" },
    };
    const jobWithDoc = { ...baseJob([tripRow({ id: "trip-a" })]), documents: [quotationDoc] };
    const { svc } = makeService({
      todayJobs: [jobWithDoc],
      runSheetTrips: [tripRow({ id: "trip-a" })],
      outsideTrips: [],
    });

    await expect(svc.getDriverHome(tenantId, driver1, date)).resolves.toBeDefined();

    const active = await svc.listActiveByDriver(tenantId, driver1, { date, sortBy: "createdAt" });
    const docs = active.data[0]?.documents ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0].originalName).toBe("quote.pdf");
    expect(docs[0].url).toBeNull();
    expect(docs[0].downloadUrl).toBeNull();
    expect(docs[0].previewUrl).toBeNull();
    expect(docs[0].requiresSignature).toBe(false);
  });

  it("returns slim trip cards without signed URLs or cargo items", async () => {
    const { svc } = makeService({
      todayJobs: [baseJob([tripRow({ id: "trip-a" })])],
      runSheetTrips: [tripRow({ id: "trip-a" })],
      outsideTrips: [
        outsideTrip({ id: "trip-b", plannedStartAt: new Date("2026-05-26T08:00:00.000Z") }),
      ],
    });

    const res = await svc.getDriverHome(tenantId, driver1, date);
    const serialized = JSON.stringify(res);

    expect(serialized).not.toMatch(/signedUrl|downloadUrl|previewUrl/i);
    expect(serialized).not.toContain("items");
    expect(res.today.trips[0]).toMatchObject({
      tripId: "trip-a",
      jobInternalRef: "JOB-1",
      customerName: "ACME",
    });
  });
});
