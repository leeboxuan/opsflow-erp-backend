import { BadRequestException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import {
  applyJobItemsUpdateInTransaction,
  assertJobItemsNotLinkedToFrozenTrips,
} from "./trip-job-item.mutations";

describe("assertJobItemsNotLinkedToFrozenTrips", () => {
  it("rejects when JobItem is linked to COMPLETED trip", async () => {
    const prisma = {
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([
          { jobItemId: "it1", tripId: "trip-done", trip: { id: "trip-done", status: TripStatus.COMPLETED } },
        ]),
      },
    };
    await expect(
      assertJobItemsNotLinkedToFrozenTrips(prisma, {
        tenantId: "t1",
        jobItemIds: ["it1"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when JobItem is linked to DONE trip", async () => {
    const prisma = {
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([
          { jobItemId: "it1", tripId: "trip-done", trip: { id: "trip-done", status: TripStatus.DONE } },
        ]),
      },
    };
    await expect(
      assertJobItemsNotLinkedToFrozenTrips(prisma, {
        tenantId: "t1",
        jobItemIds: ["it1"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows when no frozen links", async () => {
    const prisma = {
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    await expect(
      assertJobItemsNotLinkedToFrozenTrips(prisma, {
        tenantId: "t1",
        jobItemIds: ["it1"],
      }),
    ).resolves.toBeUndefined();
  });

  it("fails closed when tripJobItem.findMany is unavailable", async () => {
    await expect(
      assertJobItemsNotLinkedToFrozenTrips({} as any, {
        tenantId: "t1",
        jobItemIds: ["it1"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("applyJobItemsUpdateInTransaction", () => {
  function makeTx(opts?: {
    existing?: string[];
    frozenLinks?: Array<{ jobItemId: string; tripId: string; status: TripStatus }>;
  }) {
    const existing = opts?.existing ?? ["it1", "it2"];
    const frozen = opts?.frozenLinks ?? [];
    const calls: string[] = [];
    const tx: any = {
      jobItem: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          calls.push("jobItem.findMany");
          if (where?.id?.in) {
            return existing
              .filter((id) => where.id.in.includes(id))
              .map((id) => ({ id }));
          }
          return existing.map((id) => ({ id }));
        }),
        deleteMany: jest.fn().mockImplementation(async () => {
          calls.push("jobItem.deleteMany");
          return { count: 1 };
        }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockImplementation(async () => {
          calls.push("jobItem.update");
          return {};
        }),
      },
      tripJobItem: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const ids: string[] = where?.jobItemId?.in ?? [];
          return frozen
            .filter((f) => ids.includes(f.jobItemId))
            .map((f) => ({
              jobItemId: f.jobItemId,
              tripId: f.tripId,
              trip: { id: f.tripId, status: f.status },
            }));
        }),
      },
      __calls: calls,
    };
    return tx;
  }

  it("rejects COMPLETED-linked item deletion with no partial mutation", async () => {
    const tx = makeTx({
      existing: ["it1", "it2"],
      frozenLinks: [
        { jobItemId: "it2", tripId: "t-c", status: TripStatus.COMPLETED },
      ],
    });
    await expect(
      applyJobItemsUpdateInTransaction(tx, {
        tenantId: "ten",
        jobId: "job1",
        replaceItems: true,
        validItems: [
          {
            id: "it1",
            itemCode: "C1",
            description: null,
            sealNo: null,
            pickupReference: null,
            qty: null,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.jobItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.jobItem.update).not.toHaveBeenCalled();
  });

  it("rejects DONE-linked clear-all before delete", async () => {
    const tx = makeTx({
      existing: ["it1"],
      frozenLinks: [
        { jobItemId: "it1", tripId: "t-d", status: TripStatus.DONE },
      ],
    });
    await expect(
      applyJobItemsUpdateInTransaction(tx, {
        tenantId: "ten",
        jobId: "job1",
        replaceItems: true,
        validItems: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.jobItem.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects id-less payload against existing items", async () => {
    const tx = makeTx({ existing: ["it1"] });
    await expect(
      applyJobItemsUpdateInTransaction(tx, {
        tenantId: "ten",
        jobId: "job1",
        validItems: [
          {
            id: null,
            itemCode: "NEW",
            description: null,
            sealNo: null,
            pickupReference: null,
            qty: null,
          },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/stable item ids/i),
    });
    expect(tx.jobItem.deleteMany).not.toHaveBeenCalled();
  });

  it("patch mode updates one JobItem without deleting siblings", async () => {
    const tx = makeTx({ existing: ["it1", "it2"] });
    await applyJobItemsUpdateInTransaction(tx, {
      tenantId: "ten",
      jobId: "job1",
      replaceItems: false,
      validItems: [
        {
          id: "it1",
          itemCode: "UPDATED",
          description: null,
          sealNo: "S1",
          pickupReference: null,
          qty: null,
        },
      ],
    });
    expect(tx.jobItem.update).toHaveBeenCalledWith({
      where: { id: "it1" },
      data: expect.objectContaining({ itemCode: "UPDATED", sealNo: "S1" }),
    });
    expect(tx.jobItem.deleteMany).not.toHaveBeenCalled();
  });

  it("replace mode deletes unlinked mutable siblings", async () => {
    const tx = makeTx({ existing: ["it1", "it2"], frozenLinks: [] });
    await applyJobItemsUpdateInTransaction(tx, {
      tenantId: "ten",
      jobId: "job1",
      replaceItems: true,
      validItems: [
        {
          id: "it1",
          itemCode: "C1",
          description: null,
          sealNo: null,
          pickupReference: null,
          qty: null,
        },
      ],
    });
    expect(tx.jobItem.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "ten", jobId: "job1", id: { in: ["it2"] } },
    });
    expect(tx.jobItem.update).toHaveBeenCalled();
  });

  it("mixed mutable + frozen reject whole replace", async () => {
    const tx = makeTx({
      existing: ["it1", "it2"],
      frozenLinks: [
        { jobItemId: "it2", tripId: "t1", status: TripStatus.COMPLETED },
      ],
    });
    await expect(
      applyJobItemsUpdateInTransaction(tx, {
        tenantId: "ten",
        jobId: "job1",
        replaceItems: true,
        validItems: [
          {
            id: "it1",
            itemCode: "C1",
            description: null,
            sealNo: null,
            pickupReference: null,
            qty: null,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.jobItem.update).not.toHaveBeenCalled();
  });
});
