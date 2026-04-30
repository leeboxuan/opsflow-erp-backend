import { DispatchService } from "./dispatch.service";

describe("DispatchService", () => {
  it("dispatch board includes parked trailer marker fields", async () => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "driver-user-1", name: "Driver A", phone: "123" },
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
            title: "Trip title",
            displayTitle: null,
            plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
            jobSequence: 1,
            tripSequence: 1,
            originLabel: "A",
            destinationLabel: "B",
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
    expect(res.drivers[0].activeTrip.trailerParkedAt).toEqual(new Date("2026-04-30T12:00:00.000Z"));
    expect(res.drivers[0].activeTrip.trailerParkingLat).toBe(1.31);
    expect(res.drivers[0].activeTrip.trailerParkingLng).toBe(103.71);
  });
});
