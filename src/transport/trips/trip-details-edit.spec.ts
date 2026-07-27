import {
  JobStatus,
  JobTripTemplate,
  JobType,
  Role,
  TripStatus,
} from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import {
  TransportJobsService,
  assertTripDetailsEditAllowed,
} from "../jobs/transport-jobs.service";
import { DriverJobsService } from "../driver-app/driver-jobs.service";

function makeOpsService(prisma: any): TransportJobsService {
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const supabaseService = { getClient: jest.fn() } as any;
  return new TransportJobsService(prisma, audit, supabaseService);
}

describe("assertTripDetailsEditAllowed", () => {
  it("blocks route edits while trip is ONGOING", () => {
    expect(() =>
      assertTripDetailsEditAllowed(TripStatus.ONGOING, JobStatus.ONGOING, {
        pickupAddress1: "New pickup",
      } as any),
    ).toThrow(BadRequestException);
    expect(() =>
      assertTripDetailsEditAllowed(TripStatus.ONGOING, JobStatus.ONGOING, {
        pickupAddress1: "New pickup",
      } as any),
    ).toThrow("Cannot change pickup/delivery route while trip is ONGOING");
  });

  it("allows notes and contact on PUBLISHED trips", () => {
    expect(() =>
      assertTripDetailsEditAllowed(TripStatus.PUBLISHED, JobStatus.ONGOING, {
        notes: "Call before arrival",
        receiverName: "Derek",
        plannedStartAt: "2026-06-10T08:30:00.000Z",
      } as any),
    ).not.toThrow();
  });

  it("allows notes only on completed trips", () => {
    expect(() =>
      assertTripDetailsEditAllowed(TripStatus.COMPLETED, JobStatus.ONGOING, {
        notes: "Correction note",
      } as any),
    ).not.toThrow();
    expect(() =>
      assertTripDetailsEditAllowed(TripStatus.COMPLETED, JobStatus.ONGOING, {
        pickupAddress1: "Changed",
      } as any),
    ).toThrow("Completed trips only allow notes and trip contact/timing corrections");
  });
});

describe("TransportJobsService.patchTripDetails", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const user = { userId: "u1", role: Role.TRANSPORT_STAFF };

  function basePrisma(overrides: {
    job?: Record<string, unknown>;
    trip?: Record<string, unknown>;
  } = {}) {
    const jobUpdate = jest.fn().mockResolvedValue({});
    const tripUpdate = jest.fn().mockResolvedValue({});
    return {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          tenantId,
          jobType: JobType.LCL,
          status: JobStatus.ONGOING,
          ...overrides.job,
        }),
        update: jobUpdate,
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          tenantId,
          jobId,
          status: TripStatus.PUBLISHED,
          assignedDriverUserId: "driver1",
          jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
          originLat: 1.1,
          originLng: 103.1,
          originPlaceId: "place-old",
          destinationLat: 1.2,
          destinationLng: 103.2,
          destinationPlaceId: "place-dest-old",
          ...overrides.trip,
        }),
        update: tripUpdate,
      },
      $transaction: jest.fn(async (fn: (tx: any) => Promise<void>) =>
        fn({
          job: { update: jobUpdate },
          trip: { update: tripUpdate },
          jobItem: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        }),
      ),
      jobItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      __jobUpdate: jobUpdate,
      __tripUpdate: tripUpdate,
    };
  }

  it("updates plannedStartAt on PUBLISHED trip", async () => {
    const prisma = basePrisma();
    const svc = makeOpsService(prisma);
    jest.spyOn(svc, "getTripDetail").mockResolvedValue({ id: tripId } as any);
    jest.spyOn(svc as any, "syncTripRouteSnapshotForJob").mockResolvedValue(undefined);

    await svc.patchTripDetails(tenantId, jobId, tripId, {
      plannedStartAt: "2026-06-10T08:30:00.000Z",
    }, user);

    expect(prisma.__tripUpdate).toHaveBeenCalledWith({
      where: { id: tripId },
      data: expect.objectContaining({
        plannedStartAt: new Date("2026-06-10T08:30:00.000Z"),
        updatedByUserId: "u1",
      }),
    });
  });

  it("updates trip notes and contact fields", async () => {
    const prisma = basePrisma();
    const svc = makeOpsService(prisma);
    jest.spyOn(svc, "getTripDetail").mockResolvedValue({ id: tripId } as any);
    jest.spyOn(svc as any, "syncTripRouteSnapshotForJob").mockResolvedValue(undefined);

    await svc.patchTripDetails(tenantId, jobId, tripId, {
      notes: "Use side gate for this trip.",
      pickupContactName: "Ah Tan",
      pickupContactPhone: "91234567",
      receiverName: "Derek",
      receiverPhone: "91234567",
    }, user);

    expect(prisma.__tripUpdate).toHaveBeenCalledWith({
      where: { id: tripId },
      data: expect.objectContaining({
        notes: "Use side gate for this trip.",
      }),
    });
    expect(prisma.__jobUpdate).toHaveBeenCalledWith({
      where: { id: jobId },
      data: expect.objectContaining({
        pickupContactName: "Ah Tan",
        pickupContactPhone: "91234567",
        receiverName: "Derek",
        receiverPhone: "91234567",
      }),
    });
  });

  it("updates jobNotes on job when jobNotes alias is used", async () => {
    const prisma = basePrisma();
    const svc = makeOpsService(prisma);
    jest.spyOn(svc, "getTripDetail").mockResolvedValue({ id: tripId } as any);
    jest.spyOn(svc as any, "syncTripRouteSnapshotForJob").mockResolvedValue(undefined);

    await svc.patchTripDetails(tenantId, jobId, tripId, {
      jobNotes: "Driver to call before arrival.",
    }, user);

    expect(prisma.__jobUpdate).toHaveBeenCalledWith({
      where: { id: jobId },
      data: expect.objectContaining({
        notes: "Driver to call before arrival.",
      }),
    });
  });

  it("syncs route snapshots when pickup/delivery address changes on PUBLISHED trip", async () => {
    const prisma = basePrisma();
    const svc = makeOpsService(prisma);
    jest.spyOn(svc, "getTripDetail").mockResolvedValue({ id: tripId } as any);
    const syncSpy = jest
      .spyOn(svc as any, "syncTripRouteSnapshotForJob")
      .mockResolvedValue(undefined);

    await svc.patchTripDetails(tenantId, jobId, tripId, {
      pickupAddress1: "7 Gul Cir, 7 Gul Circle",
      pickupPostal: "629563",
      pickupLat: 1.31,
      pickupLng: 103.7,
      deliveryAddress1: "8 Gul Cir, 8 Gul Circle",
      deliveryPostal: "629564",
    }, user);

    expect(syncSpy).toHaveBeenCalledWith(
      tenantId,
      jobId,
      expect.objectContaining({
        pickupLat: 1.31,
        pickupLng: 103.7,
        tripStatuses: [TripStatus.DRAFT, TripStatus.PUBLISHED],
      }),
    );
  });

  it("rejects route edit on ONGOING trip", async () => {
    const prisma = basePrisma({
      trip: { status: TripStatus.ONGOING },
    });
    const svc = makeOpsService(prisma);

    await expect(
      svc.patchTripDetails(tenantId, jobId, tripId, {
        deliveryAddress1: "New delivery",
      }, user),
    ).rejects.toThrow("Cannot change pickup/delivery route while trip is ONGOING");
  });

  it("syncs IMPORT return depot change for planning trips only", async () => {
    const prisma = basePrisma({
      job: { jobType: JobType.IMPORT, returningDepotCode: "DEPOT-A" },
      trip: { status: TripStatus.PUBLISHED },
    });
    const svc = makeOpsService(prisma);
    jest.spyOn(svc, "getTripDetail").mockResolvedValue({ id: tripId } as any);
    const syncSpy = jest
      .spyOn(svc as any, "syncTripRouteSnapshotForJob")
      .mockResolvedValue(undefined);

    await svc.patchTripDetails(tenantId, jobId, tripId, {
      returningDepotCode: "DEPOT-B",
    }, user);

    expect(syncSpy).toHaveBeenCalled();
  });
});

describe("DriverJobsService.getTripDetailForDriver notes", () => {
  it("returns jobNotes, notes, tripInstruction and plannedStartAt", async () => {
    const tenantId = "t1";
    const tripId = "trip1";
    const driverUserId = "driver1";
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          tenantId,
          jobId: "job1",
          status: TripStatus.PUBLISHED,
          assignedDriverUserId: driverUserId,
          plannedStartAt: new Date("2026-06-10T08:30:00.000Z"),
          jobSequence: 1,
          tripSequence: 1,
          title: "Leg 1",
          displayTitle: "Leg 1",
          tripPICName: null,
          tripPICContact: null,
          containerNumber: null,
          carrier: null,
          shipper: null,
          vessel: null,
          originLabel: "Origin",
          destinationLabel: "Destination",
          originAddressLine1: "A",
          originAddressLine2: null,
          originPostalCode: "1",
          originCountry: "SG",
          originLat: null,
          originLng: null,
          destinationAddressLine1: "B",
          destinationAddressLine2: null,
          destinationPostalCode: "2",
          destinationCountry: "SG",
          destinationLat: null,
          destinationLng: null,
          trailerNumber: null,
          trailerLastLocationCode: null,
          trailerParkedAt: null,
          trailerParkingLat: null,
          trailerParkingLng: null,
          publishedAt: null,
          startedAt: null,
          closedAt: null,
          notes: "Use loading bay B.",
          documents: [],
          job: {
            id: "job1",
            internalRef: "JOB-1",
            externalRef: null,
            jobType: JobType.LCL,
            collectionType: null,
            status: JobStatus.ONGOING,
            notes: "Driver to call before arrival.",
            customerCompany: { name: "ACME" },
            items: [],
          },
        }),
      },
      masterTrailerLocation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);

    const detail = await svc.getTripDetailForDriver(tenantId, tripId, driverUserId);

    expect(detail.plannedStartAt).toEqual(new Date("2026-06-10T08:30:00.000Z"));
    expect(detail.notes).toBe("Use loading bay B.");
    expect(detail.jobNotes).toBe("Driver to call before arrival.");
    expect(detail.tripInstruction).toBe("Driver to call before arrival.");
    expect(detail.job?.jobNotes).toBe("Driver to call before arrival.");
  });
});
