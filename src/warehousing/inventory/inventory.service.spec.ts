import { InventoryUnitStatus } from "@prisma/client";
import { InventoryService } from "./inventory.service";

describe("InventoryService.listBatches", () => {
  it("loads unit counts via one groupBy and maps mixed statuses", async () => {
    const prisma: any = {
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      inventory_batches: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "batch-a",
            containerNumber: "B1",
            customerName: "Acme",
            customerRef: null,
            receivedAt: null,
            notes: null,
            status: "Open",
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-02"),
          },
          {
            id: "batch-b",
            containerNumber: "B2",
            customerName: null,
            customerRef: null,
            receivedAt: null,
            notes: null,
            status: "Open",
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-02"),
          },
        ]),
      },
      inventory_units: {
        groupBy: jest.fn().mockResolvedValue([
          {
            batchId: "batch-a",
            status: InventoryUnitStatus.Available,
            _count: { _all: 3 },
          },
          {
            batchId: "batch-a",
            status: InventoryUnitStatus.Reserved,
            _count: { _all: 2 },
          },
          {
            batchId: "batch-a",
            status: InventoryUnitStatus.InTransit,
            _count: { _all: 1 },
          },
          {
            batchId: "batch-b",
            status: InventoryUnitStatus.Delivered,
            _count: { _all: 4 },
          },
          {
            batchId: "batch-b",
            status: InventoryUnitStatus.Returned,
            _count: { _all: 1 },
          },
        ]),
        count: jest.fn(),
      },
    };

    const svc = new InventoryService(prisma);
    const result = await svc.listBatches("tenant-1", { page: 1, pageSize: 20 });

    expect(prisma.inventory_units.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.inventory_units.groupBy).toHaveBeenCalledWith({
      by: ["batchId", "status"],
      where: {
        tenantId: "tenant-1",
        batchId: { in: ["batch-a", "batch-b"] },
      },
      _count: { _all: true },
    });
    expect(prisma.inventory_units.count).not.toHaveBeenCalled();

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id: "batch-a",
      totalUnits: 6,
      availableUnits: 3,
      reservedUnits: 2,
      inTransitUnits: 1,
      deliveredUnits: 0,
    });
    expect(result.data[1]).toMatchObject({
      id: "batch-b",
      totalUnits: 5,
      availableUnits: 0,
      reservedUnits: 0,
      inTransitUnits: 0,
      deliveredUnits: 4,
    });
  });
});
