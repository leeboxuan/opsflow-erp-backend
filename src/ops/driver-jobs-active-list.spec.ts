import { JobStatus, TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.listActiveByDriver driver-scoped home list", () => {
  const tenantId = "tenant-1";
  const driver1 = "driver-1";
  const driver2 = "driver-2";
  const date = "2026-05-25";

  function baseJob(trips: any[]) {
    return {
      id: "job-multi",
      tenantId,
      customerCompanyId: "c1",
      internalRef: "JOB-MULTI",
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
      documents: [
        {
          id: "doc-1",
          type: "OTHER",
          originalName: "photo.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          storageKey: "tenant/jobs/job-multi/photo.jpg",
          isActive: true,
          requiresSignature: false,
          isSigned: false,
          signedAt: null,
          signedByUserId: null,
          signedByName: null,
          createdAt: new Date("2026-05-20T00:00:00.000Z"),
          updatedAt: new Date("2026-05-20T00:00:00.000Z"),
          jobId: "job-multi",
          tripId: null,
          generatedBySystem: false,
          generatedSource: null,
        },
      ],
      trips,
    };
  }

  function tripRow(overrides: Record<string, any>) {
    return {
      id: "trip-a",
      jobId: "job-multi",
      jobSequence: 1,
      tripSequence: 1,
      assignedDriverUserId: driver1,
      status: TripStatus.PUBLISHED,
      pendingState: "NONE",
      plannedStartAt: new Date("2026-05-25T08:00:00.000Z"),
      startedAt: null,
      closedAt: null,
      title: "Driver 1 leg",
      displayTitle: null,
      tripPICName: null,
      tripPICContact: null,
      containerNumber: null,
      carrier: null,
      shipper: null,
      vessel: null,
      trailerNumber: null,
      driverEarningCents: 1000,
      earningLabelSnapshot: "Flat",
      earningRateMasterId: null,
      completionRuleJson: null,
      originLabel: "Origin A",
      originAddressLine1: "Origin A",
      destinationLabel: "Gul",
      destinationAddressLine1: "7 Gul Circle",
      ...overrides,
    };
  }

  function makeService(jobRows: any[], runSheetTrips: any[] = []) {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        count: jest.fn().mockResolvedValue(jobRows.length),
        findMany: jest.fn().mockResolvedValue(jobRows),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]) },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: driver1, name: "Driver One" }) },
      trip: { findMany: jest.fn().mockResolvedValue(runSheetTrips) },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    return { svc, prisma };
  }

  it("queries job trips with driver-only PUBLISHED/ONGOING filter when date is set", async () => {
    const driver1Trip = tripRow({ id: "trip-a", assignedDriverUserId: driver1 });
    const { svc, prisma } = makeService([baseJob([driver1Trip])], [driver1Trip]);

    await svc.listActiveByDriver(tenantId, driver1, { date, sortBy: "createdAt" });

    const findManyArg = prisma.job.findMany.mock.calls[0][0];
    expect(findManyArg.include.trips.where).toEqual({
      assignedDriverUserId: driver1,
      status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
    });
  });

  it("returns only the calling driver’s open trips on the job card (not other drivers’ legs)", async () => {
    const driver1Trip = tripRow({
      id: "trip-a",
      assignedDriverUserId: driver1,
      status: TripStatus.PUBLISHED,
    });
    const { svc } = makeService([baseJob([driver1Trip])], [driver1Trip]);

    const res = await svc.listActiveByDriver(tenantId, driver1, { date, sortBy: "createdAt" });

    expect(res.data).toHaveLength(1);
    const trips = res.data[0].trips ?? [];
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe("trip-a");
    expect(trips[0].assignedDriverUserId).toBe(driver1);
    expect(trips.map((t: any) => t.id)).not.toContain("trip-b");
  });

  it("excludes COMPLETED/DONE legs from job card trips when date-filtered", async () => {
    const publishedTrip = tripRow({
      id: "trip-open",
      status: TripStatus.PUBLISHED,
    });
    const { svc } = makeService([baseJob([publishedTrip])]);

    const res = await svc.listActiveByDriver(tenantId, driver1, { date, sortBy: "createdAt" });

    const tripIds = (res.data[0].trips ?? []).map((t: any) => t.id);
    expect(tripIds).toEqual(["trip-open"]);
    expect(tripIds).not.toContain("trip-done");
  });

  it("does not generate signed URLs on active jobs documents (metadata only)", async () => {
    const { svc } = makeService([baseJob([tripRow({ id: "trip-a" })])]);

    const res = await svc.listActiveByDriver(tenantId, driver1, { date, sortBy: "createdAt" });

    const docs = res.data[0].documents ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0].url).toBeNull();
    expect(docs[0].downloadUrl).toBeNull();
    expect(docs[0].previewUrl).toBeNull();
    expect(docs[0].originalName).toBe("photo.jpg");
  });

  it("includes runSheet progress for the day when date is provided", async () => {
    const openTrip = tripRow({ id: "trip-open", status: TripStatus.PUBLISHED });
    const doneTrip = tripRow({
      id: "trip-done",
      status: TripStatus.COMPLETED,
      closedAt: new Date("2026-05-25T12:00:00.000Z"),
      tripSequence: 2,
    });
    const { svc } = makeService([baseJob([openTrip])], [doneTrip, openTrip]);

    const res = await svc.listActiveByDriver(tenantId, driver1, { date, sortBy: "createdAt" });

    expect(res.runSheet).not.toBeNull();
    expect(res.runSheet?.trips.map((t: any) => t.tripId)).toEqual(
      expect.arrayContaining(["trip-done", "trip-open"]),
    );
    expect(res.runSheet?.completedTrips).toBe(1);
  });

  it("omits runSheet when date is not provided", async () => {
    const { svc } = makeService([baseJob([tripRow({ id: "trip-a" })])]);

    const res = await svc.listActiveByDriver(tenantId, driver1, { sortBy: "createdAt" });

    expect(res.runSheet).toBeNull();
  });

  it("uses broader trip status filter when date/month is omitted (legacy unfiltered home)", async () => {
    const { svc, prisma } = makeService([baseJob([tripRow({ id: "trip-a" })])]);

    await svc.listActiveByDriver(tenantId, driver1, { sortBy: "createdAt" });

    expect(prisma.job.findMany.mock.calls[0][0].include.trips.where).toEqual({
      assignedDriverUserId: driver1,
      status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
    });
  });

  it("never returns Trip B when Driver 1 calls active list (driver filter on query)", async () => {
    const tripA = tripRow({
      id: "trip-a",
      assignedDriverUserId: driver1,
      title: "Trip A",
    });
    const { svc, prisma } = makeService([baseJob([tripA])]);

    const res = await svc.listActiveByDriver(tenantId, driver1, { date, sortBy: "createdAt" });

    const tripsWhere = prisma.job.findMany.mock.calls[0][0].include.trips.where;
    expect(tripsWhere.assignedDriverUserId).toBe(driver1);
    expect(tripsWhere.assignedDriverUserId).not.toBe(driver2);

    const returnedIds = res.data.flatMap((j) => (j.trips ?? []).map((t: any) => t.id));
    expect(returnedIds).toEqual(["trip-a"]);
    expect(returnedIds).not.toContain("trip-b");
  });
});