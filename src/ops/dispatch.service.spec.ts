import { DispatchService } from "./dispatch.service";
import { BadRequestException } from "@nestjs/common";

describe("DispatchService", () => {
  const originalRoutesKey = process.env.GOOGLE_ROUTES_API_KEY;
  const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY;

  afterEach(() => {
    process.env.GOOGLE_ROUTES_API_KEY = originalRoutesKey;
    process.env.GOOGLE_MAPS_API_KEY = originalMapsKey;
    delete (global as any).fetch;
  });

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
            containerNumber: "CONT-100",
            carrier: "Carrier A",
            shipper: "Shipper A",
            vessel: "Vessel A",
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
    expect(res.drivers[0].gpsStatus).toBe("LIVE");
    expect(res.date).toBe("2026-04-30");
    expect(res.drivers[0].driverPhone).toBe("123");
    expect(res.drivers[0].vehicleNumber).toBe("SBA1234X");
    expect(res.drivers[0].trips).toHaveLength(1);
    expect(trip.jobRef).toBe("JOB-1");
    expect(trip.tripDisplayRef).toBe("JOB-1-T01");
    expect(trip.containerNumber).toBe("CONT-100");
    expect(trip.carrier).toBe("Carrier A");
    expect(trip.shipper).toBe("Shipper A");
    expect(trip.vessel).toBe("Vessel A");
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
    expect(res.drivers[0].gpsStatus).toBe("NO_GPS");
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
    expect(res.drivers[0].gpsStatus).toBe("LIVE");
  });

  it("prefers capturedAt over recordedAt/updatedAt for gps age", async () => {
    const capturedAt = new Date(Date.now() - 30 * 1000);
    const recordedAt = new Date(Date.now() - 20 * 60 * 1000);
    const updatedAt = new Date(Date.now() - 20 * 60 * 1000);
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
            capturedAt,
            recordedAt,
            updatedAt,
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          { id: "drv-1", userId: "driver-user-1", assignedVehicle: null, assignedFleetVehicle: null },
        ]),
      },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].lastGpsAgeMinutes).toBe(0);
    expect(res.drivers[0].gpsStatus).toBe("LIVE");
  });

  it("driver with no trips and GPS 3 minutes ago is LIVE", async () => {
    const capturedAt = new Date(Date.now() - 3 * 60 * 1000);
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
            speed: 5,
            capturedAt,
            recordedAt: capturedAt,
            updatedAt: capturedAt,
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          { id: "drv-1", userId: "driver-user-1", assignedVehicle: null, assignedFleetVehicle: null },
        ]),
      },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].activeTrip).toBeNull();
    expect(res.drivers[0].todayTrips).toEqual([]);
    expect(res.drivers[0].trips).toEqual([]);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeGreaterThanOrEqual(2);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeLessThanOrEqual(4);
    expect(res.drivers[0].gpsStatus).toBe("LIVE");
  });

  it("driver with no trips and GPS 20 minutes ago is STALE", async () => {
    const capturedAt = new Date(Date.now() - 20 * 60 * 1000);
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
            speed: 0,
            capturedAt,
            recordedAt: capturedAt,
            updatedAt: capturedAt,
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          { id: "drv-1", userId: "driver-user-1", assignedVehicle: null, assignedFleetVehicle: null },
        ]),
      },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].activeTrip).toBeNull();
    expect(res.drivers[0].todayTrips).toEqual([]);
    expect(res.drivers[0].trips).toEqual([]);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeGreaterThanOrEqual(19);
    expect(res.drivers[0].gpsStatus).toBe("STALE");
  });

  it("driver with no trips and no latestLocation is NO_GPS", async () => {
    const prisma: any = {
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([{ user: { id: "driver-user-1", name: "Driver A", phone: "123" } }]),
      },
      driverLocationLatest: { findMany: jest.fn().mockResolvedValue([]) },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          { id: "drv-1", userId: "driver-user-1", assignedVehicle: null, assignedFleetVehicle: null },
        ]),
      },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].activeTrip).toBeNull();
    expect(res.drivers[0].todayTrips).toEqual([]);
    expect(res.drivers[0].trips).toEqual([]);
    expect(res.drivers[0].lastGpsAgeMinutes).toBeNull();
    expect(res.drivers[0].gpsStatus).toBe("NO_GPS");
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
            capturedAt: null,
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
    expect(res.drivers[0].gpsStatus).toBe("STALE");
  });

  it("marks fresh moving GPS as LIVE", async () => {
    const recordedAt = new Date(Date.now() - 1 * 60 * 1000);
    const lastMovedAt = new Date(Date.now() - 1 * 60 * 1000);
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
            speed: 10,
            recordedAt,
            updatedAt: new Date(),
            lastMovedAt,
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", new Date().toISOString().slice(0, 10));
    expect(res.drivers[0].gpsStatus).toBe("LIVE");
  });

  it("marks fresh but unmoved GPS as IDLE", async () => {
    const recordedAt = new Date(Date.now() - 1 * 60 * 1000);
    const lastMovedAt = new Date(Date.now() - 12 * 60 * 1000);
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
            speed: 0,
            recordedAt,
            updatedAt: new Date(),
            lastMovedAt,
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", new Date().toISOString().slice(0, 10));
    expect(res.drivers[0].stationaryMinutes).toBeGreaterThanOrEqual(10);
    expect(res.drivers[0].gpsStatus).toBe("IDLE");
  });

  it("marks old-day GPS as STALE (not NO_GPS) when timestamp exists", async () => {
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
            speed: 0,
            recordedAt: new Date("2026-05-03T23:59:00.000Z"),
            updatedAt: new Date("2026-05-03T23:59:00.000Z"),
            lastMovedAt: new Date("2026-05-03T23:58:00.000Z"),
          },
        ]),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      drivers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new DispatchService(prisma, { getClient: jest.fn() } as any);
    const res = await svc.getBoard("tenant-1", "2026-05-05");
    expect(res.drivers[0].lastGpsAgeMinutes).not.toBeNull();
    expect(res.drivers[0].gpsStatus).toBe("STALE");
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

  it("validates required route coordinates", async () => {
    const svc = new DispatchService({} as any, { getClient: jest.fn() } as any);
    await expect(
      svc.getDispatchRoute("tenant-1", {
        fromLat: Number.NaN,
        fromLng: 103.8,
        toLat: 1.3,
        toLng: 103.9,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns cached route on second call", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{
          distanceMeters: 1000,
          duration: "120s",
          staticDuration: "110s",
          polyline: { encodedPolyline: "abc123" },
          routeLabels: ["DEFAULT_ROUTE"],
        }],
      }),
    });
    const svc = new DispatchService({} as any, { getClient: jest.fn() } as any);
    const first = await svc.getDispatchRoute("tenant-1", {
      fromLat: 1.29,
      fromLng: 103.85,
      toLat: 1.3,
      toLng: 103.86,
      mode: "DRIVE" as any,
    });
    const second = await svc.getDispatchRoute("tenant-1", {
      fromLat: 1.29,
      fromLng: 103.85,
      toLat: 1.3,
      toLng: 103.86,
      mode: "DRIVE" as any,
    });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it("handles google route failure gracefully", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "google error",
    });
    const svc = new DispatchService({} as any, { getClient: jest.fn() } as any);
    const res = await svc.getDispatchRoute("tenant-1", {
      fromLat: 1.29,
      fromLng: 103.85,
      toLat: 1.3,
      toLng: 103.86,
      mode: "DRIVE" as any,
    });
    expect(res.polyline).toBeNull();
    expect(res.error).toContain("Google Routes error");
  });

  it("parses encoded polyline and durations", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{
          distanceMeters: 3210,
          duration: "345s",
          staticDuration: "300s",
          polyline: { encodedPolyline: "encoded-poly" },
          routeLabels: ["DEFAULT_ROUTE"],
        }],
      }),
    });
    const svc = new DispatchService({} as any, { getClient: jest.fn() } as any);
    const res = await svc.getDispatchRoute("tenant-1", {
      fromLat: 1.29,
      fromLng: 103.85,
      toLat: 1.3,
      toLng: 103.86,
      mode: "DRIVE" as any,
    });
    expect(res.polyline).toBe("encoded-poly");
    expect(res.distanceMeters).toBe(3210);
    expect(res.durationSeconds).toBe(345);
    expect(res.staticDurationSeconds).toBe(300);
  });
});
