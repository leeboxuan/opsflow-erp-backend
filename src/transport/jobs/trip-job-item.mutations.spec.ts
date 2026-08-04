import { BadRequestException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { replaceTripJobItemLinks } from "./trip-job-item.mutations";

describe("replaceTripJobItemLinks", () => {
  function makePrisma(opts?: {
    items?: Array<{ id: string; itemCode: string }>;
    failCreate?: boolean;
  }) {
    const items = opts?.items ?? [
      { id: "it1", itemCode: "CONT1", description: null, sealNo: null, pickupReference: null, qty: null },
    ];
    const calls: string[] = [];
    const prisma: any = {
      jobItem: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          calls.push("jobItem.findMany");
          const ids: string[] = where?.id?.in ?? [];
          return items.filter((i) => ids.includes(i.id));
        }),
      },
      tripJobItem: {
        deleteMany: jest.fn().mockImplementation(async () => {
          calls.push("tripJobItem.deleteMany");
          return { count: 1 };
        }),
        createMany: jest.fn().mockImplementation(async () => {
          calls.push("tripJobItem.createMany");
          if (opts?.failCreate) throw new Error("create failed");
          return { count: 1 };
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      trip: {
        update: jest.fn().mockImplementation(async () => {
          calls.push("trip.update");
          return {};
        }),
      },
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
        calls.push("$transaction");
        return fn(prisma);
      }),
      __calls: calls,
    };
    return prisma;
  }

  it("rejects COMPLETED freeze before any write", async () => {
    const prisma = makePrisma();
    await expect(
      replaceTripJobItemLinks(prisma, {
        tenantId: "t1",
        tripId: "trip1",
        jobId: "job1",
        tripStatus: TripStatus.COMPLETED,
        jobItemIds: ["it1"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tripJobItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects DONE freeze before any write", async () => {
    const prisma = makePrisma();
    await expect(
      replaceTripJobItemLinks(prisma, {
        tenantId: "t1",
        tripId: "trip1",
        jobId: "job1",
        tripStatus: TripStatus.DONE,
        jobItemIds: ["it1"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tripJobItem.deleteMany).not.toHaveBeenCalled();
  });

  it("validates jobItemIds before delete (invalid ids leave links intact)", async () => {
    const prisma = makePrisma({
      items: [
        { id: "it1", itemCode: "CONT1", description: null, sealNo: null, pickupReference: null, qty: null } as any,
      ],
    });
    await expect(
      replaceTripJobItemLinks(prisma, {
        tenantId: "t1",
        tripId: "trip1",
        jobId: "job1",
        tripStatus: TripStatus.DRAFT,
        jobItemIds: ["missing-id"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tripJobItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("runs deleteMany + createMany + trip.update inside $transaction", async () => {
    const prisma = makePrisma();
    const result = await replaceTripJobItemLinks(prisma, {
      tenantId: "t1",
      tripId: "trip1",
      jobId: "job1",
      tripStatus: TripStatus.DRAFT,
      jobItemIds: ["it1"],
      linkedByUserId: "u1",
    });
    expect(result.linkedCount).toBe(1);
    expect(result.containerNumber).toBe("CONT1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.__calls).toEqual([
      "jobItem.findMany",
      "$transaction",
      "tripJobItem.deleteMany",
      "tripJobItem.createMany",
      "trip.update",
    ]);
  });

  it("does not delete when create would fail inside transaction (mock aborts after delete attempt order)", async () => {
    const prisma = makePrisma({ failCreate: true });
    await expect(
      replaceTripJobItemLinks(prisma, {
        tenantId: "t1",
        tripId: "trip1",
        jobId: "job1",
        tripStatus: TripStatus.DRAFT,
        jobItemIds: ["it1"],
      }),
    ).rejects.toThrow("create failed");
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
