import { DispatchService } from "./dispatch.service";
import { BadRequestException } from "@nestjs/common";

describe("DispatchService", () => {
  it("dispatch board includes coordinates, timeline, parked markers, and gps age", async () => {
    const capturedAt = new Date(Date.now() - 5 * 60 * 1000);
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { user: { id: "driver-user-1", name: "Driver A", phone: "123" } },
        ]),
      },
      driverLocationLatest: {
        findMany: jest.fn().mockResolvedValue([
          {
            driverUserId: "driver-user-1",
            lat: 1.22,
            lng: 103.55,
            accuracy: 10,
            heading: 180,
            speed: 8,
            capturedAt,
          },
        ]),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            jobId: "job1",
            assignedDriverUserId: "driver-user-1",
            status: "ONGOING",
            title: "Trip title",
            displayTitle: null,
            plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
            publishedAt: new Date("2026-04-30T07:50:00.000Z"),
            startedAt: new Date("2026-04-30T08:05:00.000Z"),
            closedAt: new Date("2026-04-30T12:15:00.000Z"),
            jobSequence: 1,
            tripSequence: 1,
            originLabel: "A",
            destinationLabel: "B",
            originLat: 1.11,
            originLng: 103.61,
            destinationLat: 1.19,
            destinationLng: 103.72,
            trailerNumber: "TRL-1",
            trailerLastLocationCode: "G7",
            trailerParkedAt: new Date("2026-04-30T12:00:00.000Z"),
            trailerParkingLat: 1.31,
            trailerParkingLng: 103.71,
            job: {
              id: "job1",
              internalRef: "JOB-1",
              customerCompany: { name: "Customer A" },
            },
            documents: [],
          },
        ]),
      },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([{ code: "G7", name: "Gul 7" }]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "drv-1",
            userId: "driver-user-1",
            assignedVehicle: { plateNo: "SBA1234X" },
            assignedFleetVehicle: null,
          },
        ]),
      },
    };
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new DispatchService(prisma, supabaseService);

    const res = await svc.getBoard("tenant-1", "2026-04-30");
    const trip = res.drivers[0].activeTrip;
    expect(trip.trailerParkedAt).toEqual(new Date("2026-04-30T12:00:00.000Z"));
    expect(trip.trailerParkingLat).toBe(1.31);
    expect(trip.trailerParkingLng).toBe(103.71);
    expect(trip.originLat).toBe(1.11);
    expect(trip.originLng).toBe(103.61);
    expect(trip.destinationLat).toBe(1.19);
    expect(trip.destinationLng).toBe(103.72);
    expect(trip.publishedAt).toEqual(new Date("2026-04-30T07:50:00.000Z"));
    expect(trip.startedAt).toEqual(new Date("2026-04-30T08:05:00.000Z"));
    expect(trip.closedAt).toEqual(new Date("2026-04-30T12:15:00.000Z"));
    expect(res.drivers[0].lastGpsAgeMinutes).toBeGreaterThanOrEqual(4);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeLessThanOrEqual(6);
    expect(res.drivers[0].latestLocation?.recordedAt).toEqual(capturedAt);
    expect(res.date).toBe("2026-04-30");
    expect(res.drivers[0].driverPhone).toBe("123");
    expect(res.drivers[0].vehicleNumber).toBe("SBA1234X");
    expect(res.drivers[0].trips).toHaveLength(1);
    expect(trip.jobRef).toBe("JOB-1");
  });

  it("returns nulls safely for optional route/timeline/gps fields", async () => {
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { user: { id: "driver-user-2", name: "Driver B", phone: null } },
        ]),
      },
      driverLocationLatest: { findMany: jest.fn().mockResolvedValue([]) },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip2",
            jobId: "job2",
            assignedDriverUserId: "driver-user-2",
            status: "ONGOING",
            title: null,
            displayTitle: null,
            plannedStartAt: null,
            createdAt: new Date("2026-04-30T01:00:00.000Z"),
            publishedAt: null,
            startedAt: null,
            closedAt: null,
            jobSequence: null,
            tripSequence: null,
            originLabel: null,
            destinationLabel: null,
            originLat: null,
            originLng: null,
            destinationLat: null,
            destinationLng: null,
            trailerNumber: null,
            trailerLastLocationCode: null,
            trailerParkedAt: null,
            trailerParkingLat: null,
            trailerParkingLng: null,
            job: { id: "job2", internalRef: null, customerCompany: { name: null } },
            documents: [],
          },
        ]),
      },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "drv-2",
            userId: "driver-user-2",
            assignedVehicle: null,
            assignedFleetVehicle: null,
          },
        ]),
      },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);

    const res = await svc.getBoard("tenant-1", "2026-04-30");
    const trip = res.drivers[0].activeTrip;
    expect(trip.originLat).toBeNull();
    expect(trip.originLng).toBeNull();
    expect(trip.destinationLat).toBeNull();
    expect(trip.destinationLng).toBeNull();
    expect(trip.publishedAt).toBeNull();
    expect(trip.startedAt).toBeNull();
    expect(trip.closedAt).toBeNull();
    expect(res.drivers[0].lastGpsAgeMinutes).toBeNull();
  });

  it("board trip exposes trailer photo urls plus filename metadata without storage keys", async () => {
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { user: { id: "driver-user-1", name: "Driver A", phone: "123" } },
        ]),
      },
      driverLocationLatest: { findMany: jest.fn().mockResolvedValue([]) },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            jobId: "job1",
            assignedDriverUserId: "driver-user-1",
            status: "ONGOING",
            title: "T",
            displayTitle: null,
            plannedStartAt: null,
            createdAt: new Date("2026-04-30T01:00:00.000Z"),
            publishedAt: null,
            startedAt: null,
            closedAt: null,
            jobSequence: 1,
            tripSequence: 1,
            originLabel: null,
            destinationLabel: null,
            originLat: null,
            originLng: null,
            destinationLat: null,
            destinationLng: null,
            trailerNumber: null,
            trailerLastLocationCode: null,
            trailerParkedAt: null,
            trailerParkingLat: null,
            trailerParkingLng: null,
            job: {
              id: "job1",
              internalRef: "J1",
              customerCompany: { name: "C" },
            },
            documents: [
              {
                type: "TRAILER_START_PHOTO",
                storageKey: "t1/jobs/j1/trips/t1/trailer_start_photo/99-start.jpg",
                originalName: "start.jpg",
                mimeType: "image/jpeg",
                sizeBytes: 42,
              },
            ],
          },
        ]),
      },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "drv-1",
            userId: "driver-user-1",
            assignedVehicle: { plateNo: "SBA1" },
            assignedFleetVehicle: null,
          },
        ]),
      },
    };
    const supabaseService = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl: jest
              .fn()
              .mockResolvedValue({ data: { signedUrl: "https://signed/start" } }),
          }),
        },
      }),
    } as any;
    const svc = new DispatchService(prisma, supabaseService);
    const res = await svc.getBoard("tenant-1", "2026-04-30");
    const trip = res.drivers[0].activeTrip;
    expect(trip.trailerStartPhotoUrl).toBe("https://signed/start");
    expect(trip.trailerStartPhoto?.fileUrl).toBe("https://signed/start");
    expect(trip.trailerStartPhoto?.fileName).toBe("start.jpg");
    expect(trip.trailerStartPhoto?.originalFileName).toBe("start.jpg");
    expect(trip.trailerStartPhoto?.mimeType).toBe("image/jpeg");
    expect(trip.trailerStartPhoto?.fileSizeBytes).toBe(42);
    expect(JSON.stringify(trip)).not.toMatch(/storageKey/);
  });

  it("scopes board trips to selected date using plannedStartAt fallback createdAt", async () => {
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([{ user: { id: "driver-user-1", name: "Driver A", phone: "123" } }]),
      },
      driverLocationLatest: { findMany: jest.fn().mockResolvedValue([]) },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip-in-date",
            jobId: "job1",
            assignedDriverUserId: "driver-user-1",
            status: "PUBLISHED",
            title: "In date",
            displayTitle: null,
            plannedStartAt: new Date("2026-05-05T08:00:00.000Z"),
            createdAt: new Date("2026-05-04T00:00:00.000Z"),
            jobSequence: 1,
            tripSequence: 1,
            originLabel: null,
            destinationLabel: null,
            job: { id: "job1", internalRef: "REF-1", customerCompany: { name: "Cust" } },
            documents: [],
          },
          {
            id: "trip-created-fallback",
            jobId: "job2",
            assignedDriverUserId: null,
            status: "ONGOING",
            title: "Fallback",
            displayTitle: null,
            plannedStartAt: null,
            createdAt: new Date("2026-05-05T03:00:00.000Z"),
            jobSequence: 2,
            tripSequence: 2,
            originLabel: null,
            destinationLabel: null,
            job: { id: "job2", internalRef: "REF-2", customerCompany: { name: "Cust" } },
            documents: [],
          },
          {
            id: "trip-other-date",
            jobId: "job3",
            assignedDriverUserId: "driver-user-1",
            status: "ONGOING",
            title: "Out date",
            displayTitle: null,
            plannedStartAt: new Date("2026-05-06T08:00:00.000Z"),
            createdAt: new Date("2026-05-06T08:00:00.000Z"),
            jobSequence: 3,
            tripSequence: 3,
            originLabel: null,
            destinationLabel: null,
            job: { id: "job3", internalRef: "REF-3", customerCompany: { name: "Cust" } },
            documents: [],
          },
        ]),
      },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          { id: "drv-1", userId: "driver-user-1", assignedVehicle: null, assignedFleetVehicle: null },
        ]),
      },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].todayTrips.map((t: any) => t.id)).toEqual(["trip-in-date"]);
    expect(res.unassignedTrips.map((t: any) => t.id)).toEqual(["trip-created-fallback"]);
    expect(res.ongoingTrips.map((t: any) => t.id)).toEqual(["trip-created-fallback"]);
  });

  it("does not fail board when signed URL or trailer location lookups fail", async () => {
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([{ user: { id: "driver-user-1", name: "Driver A", phone: "123" } }]),
      },
      driverLocationLatest: { findMany: jest.fn().mockResolvedValue([]) },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip1",
            jobId: "job1",
            assignedDriverUserId: "driver-user-1",
            status: "ONGOING",
            title: "T",
            displayTitle: null,
            plannedStartAt: new Date("2026-05-05T08:00:00.000Z"),
            createdAt: new Date("2026-05-05T07:00:00.000Z"),
            jobSequence: 1,
            tripSequence: 1,
            originLabel: null,
            destinationLabel: null,
            trailerLastLocationCode: "X1",
            job: { id: "job1", internalRef: "REF-1", customerCompany: { name: "Cust" } },
            documents: [{ type: "TRAILER_START_PHOTO", storageKey: "" }],
          },
        ]),
      },
      masterTrailerLocation: { findMany: jest.fn().mockRejectedValue(new Error("db down")) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          { id: "drv-1", userId: "driver-user-1", assignedVehicle: null, assignedFleetVehicle: null },
        ]),
      },
    };
    const supabaseService = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl: jest.fn().mockRejectedValue(new Error("storage fail")),
          }),
        },
      }),
    } as any;
    const svc = new DispatchService(prisma, supabaseService);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].activeTrip.trailerStartPhotoUrl).toBeNull();
    expect(res.drivers[0].activeTrip.trailerLastLocationName).toBeNull();
  });

  it("uses updatedAt for gps age when capturedAt is missing", async () => {
    const updatedAt = new Date(Date.now() - 5 * 60 * 1000);
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([{ user: { id: "driver-user-1", name: "Driver A", phone: "123" } }]),
      },
      driverLocationLatest: {
        findMany: jest.fn().mockResolvedValue([
          {
            driverUserId: "driver-user-1",
            lat: 1.2,
            lng: 103.8,
            accuracy: null,
            heading: null,
            speed: null,
            capturedAt: null,
            updatedAt,
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].lastGpsAgeMinutes).toBeGreaterThanOrEqual(4);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeLessThanOrEqual(6);
  });

  it("uses recordedAt for gps age when present", async () => {
    const recordedAt = new Date(Date.now() - 7 * 60 * 1000);
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([{ user: { id: "driver-user-1", name: "Driver A", phone: "123" } }]),
      },
      driverLocationLatest: {
        findMany: jest.fn().mockResolvedValue([
          {
            driverUserId: "driver-user-1",
            lat: 1.2,
            lng: 103.8,
            accuracy: null,
            heading: null,
            speed: null,
            capturedAt: new Date(),
            recordedAt,
            updatedAt: new Date(),
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].latestLocation?.recordedAt).toEqual(recordedAt);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeGreaterThanOrEqual(6);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeLessThanOrEqual(8);
  });

  it("rejects reordering when requested ids include terminal trips", async () => {
    const prisma: any = {
      trip: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: "trip-open",
              plannedStartAt: new Date("2026-05-05T08:00:00.000Z"),
              createdAt: new Date("2026-05-05T08:00:00.000Z"),
            },
          ])
          .mockResolvedValueOnce([
            { id: "trip-open", status: "PUBLISHED" },
            { id: "trip-done", status: "DONE" },
          ]),
      },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    await expect(
      svc.reorderDriverTrips("tenant-1", "driver-1", {
        date: "2026-05-05",
        tripIdsInOrder: ["trip-open", "trip-done"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
