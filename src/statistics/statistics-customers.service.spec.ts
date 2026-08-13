import { JobType } from "@prisma/client";
import { StatisticsCustomersService } from "./statistics-customers.service";
import type { CompactMovement } from "./statistics-trucking.service";

function compact(partial: Partial<CompactMovement> & Pick<CompactMovement, "movementId" | "jobItemId" | "customerId">): CompactMovement {
  return {
    containerNo: "ABC",
    containerSize: "20'",
    jobId: "job-1",
    jobNo: "JOB-001",
    jobType: JobType.IMPORT,
    customerName: "Acme Logistics",
    tripId: "trip-1",
    jobSequence: 1,
    tripSequence: 1,
    originLabel: "PSA",
    destinationLabel: "Customer",
    driverUserId: "driver-1",
    vehicleKey: "vehicle-1",
    vehiclePlate: "SBA1234A",
    vehicleType: "PRIME_MOVER",
    trailerNo: null,
    tripStatus: "COMPLETED" as CompactMovement["tripStatus"],
    startedAt: new Date("2026-08-01T01:00:00.000Z"),
    closedAt: new Date("2026-08-01T02:00:00.000Z"),
    durationMs: 3_600_000,
    ...partial,
  };
}

describe("StatisticsCustomersService", () => {
  it("aggregates unique containers and movements per customer from TripJobItem", async () => {
    const trucking = {
      loadCompactMovements: jest.fn().mockResolvedValue([
        compact({
          movementId: "m1",
          jobItemId: "item-1",
          customerId: "cust-1",
          tripId: "trip-1",
        }),
        compact({
          movementId: "m2",
          jobItemId: "item-2",
          customerId: "cust-1",
          tripId: "trip-2",
          jobSequence: 2,
        }),
      ]),
    };
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      job: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new StatisticsCustomersService(prisma as never, trucking as never);
    const result = await service.getCustomers("tenant-1", {
      from: "2026-08-01",
      to: "2026-08-01",
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.customerName).toBe("Acme Logistics");
    expect(result.data[0]?.uniqueContainers).toBe(2);
    expect(result.data[0]?.containerMovements).toBe(2);
    expect(result.data[0]?.averageMovementsPerContainer).toBe(1);
    expect(trucking.loadCompactMovements).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
    );
    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1" }),
      }),
    );
  });

  it("does not mix customers across tenants", async () => {
    const trucking = {
      loadCompactMovements: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      job: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new StatisticsCustomersService(prisma as never, trucking as never);
    await service.getCustomers("tenant-b", { from: "2026-08-01", to: "2026-08-01" });
    expect(trucking.loadCompactMovements.mock.calls[0]?.[0]).toBe("tenant-b");
  });
});
