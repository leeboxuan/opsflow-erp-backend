import { DispatchService } from "./dispatch.service";

describe("DispatchService", () => {
  it("dispatch board includes coordinates, timeline, parked markers, and gps age", async () => {
    const capturedAt = new Date(Date.now() - 5 * 60 * 1000);
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "driver-user-1", name: "Driver A", phone: "123" },
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

    const res = await svc.getBoard("tenant-1");
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
  });

  it("returns nulls safely for optional route/timeline/gps fields", async () => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "driver-user-2", name: "Driver B", phone: null },
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

    const res = await svc.getBoard("tenant-1");
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
});
