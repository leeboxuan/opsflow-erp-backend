import { BadRequestException, ConflictException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import {
  DISPATCH_PLAN_CONFLICT_CODE,
  DispatchRoutePlanningService,
} from "./dispatch-route-planning.service";
import {
  assertLockedAbsoluteDispatchPositions,
  mergeSuggestedWithLockedAbsolutePositions,
  sortByDispatchSequence,
} from "./dispatch-sequence";
import { suggestTripOrderByNearestNeighbour } from "../trips/trip-order-suggest";

describe("dispatch-sequence helpers", () => {
  it("sorts by dispatchSequence, never tripSequence", () => {
    const sorted = sortByDispatchSequence([
      { id: "a", status: "DRAFT", dispatchSequence: 2, tripSequence: 1 },
      { id: "b", status: "DRAFT", dispatchSequence: 1, tripSequence: 9 },
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("requires locked trips to keep absolute indexes", () => {
    const ok = assertLockedAbsoluteDispatchPositions({
      currentOrderedIds: ["locked", "b", "c"],
      requestedIds: ["locked", "c", "b"],
      lockedIds: new Set(["locked"]),
    });
    expect(ok.ok).toBe(true);

    const bad = assertLockedAbsoluteDispatchPositions({
      currentOrderedIds: ["locked", "b", "c"],
      requestedIds: ["b", "locked", "c"],
      lockedIds: new Set(["locked"]),
    });
    expect(bad.ok).toBe(false);
    if (bad.ok === false) {
      expect(bad.position).toBe(1);
      expect(bad.tripId).toBe("locked");
    }
  });

  it("merges suggestion while keeping locked absolute slots", () => {
    expect(
      mergeSuggestedWithLockedAbsolutePositions({
        currentOrderedIds: ["L", "a", "b"],
        suggestedUnlockedIds: ["b", "a"],
        lockedIds: new Set(["L"]),
      }),
    ).toEqual(["L", "b", "a"]);
  });
});

describe("suggestTripOrderByNearestNeighbour (Phase 5 metadata)", () => {
  it("labels suggestion as Suggested sequence and preserves locked trips", () => {
    const result = suggestTripOrderByNearestNeighbour({
      trips: [
        {
          id: "locked",
          originLat: 1.4,
          originLng: 103.8,
          destinationLat: 1.41,
          destinationLng: 103.81,
          locked: true,
        },
        {
          id: "near",
          originLat: 1.3,
          originLng: 103.7,
          destinationLat: 1.31,
          destinationLng: 103.71,
        },
        {
          id: "far",
          originLat: 1.5,
          originLng: 103.9,
          destinationLat: 1.51,
          destinationLng: 103.91,
        },
      ],
      startLocation: { lat: 1.29, lng: 103.69 },
    });
    expect(result.algorithm).toBe("NEAREST_NEIGHBOUR");
    expect(result.label).toBe("Suggested sequence");
    expect(result.suggestedTripIdsInOrder[0]).toBe("locked");
    expect(result.suggestedTripIdsInOrder.slice(1)).toEqual(["near", "far"]);
  });

  it("flags missing coordinates in excluded metadata", () => {
    const result = suggestTripOrderByNearestNeighbour({
      trips: [{ id: "missing", originLat: null, originLng: null }],
    });
    expect(result.excluded.some((e) => e.reason === "MISSING_ORIGIN_COORDINATES")).toBe(
      true,
    );
  });
});

describe("DispatchRoutePlanningService Phase 5 corrections", () => {
  const planned = new Date("2026-08-19T17:00:00.000Z"); // 2026-08-20 SGT

  function baseTrip(overrides: Record<string, unknown> = {}) {
    return {
      id: "t1",
      jobId: "j1",
      status: TripStatus.DRAFT,
      tripType: "IMPORT",
      tripSequence: 7,
      jobSequence: 3,
      dispatchSequence: 1,
      dispatchVersion: 1,
      routeVersion: 99,
      plannedStartAt: planned,
      createdAt: planned,
      assignedDriverUserId: "drv1",
      originLat: 1.2,
      originLng: 103.8,
      destinationLat: 1.3,
      destinationLng: 103.9,
      originLabel: "A",
      destinationLabel: "B",
      job: {
        id: "j1",
        internalRef: "JOB-1",
        customerCompany: { name: "Acme" },
      },
      vehicles: null,
      fleetVehicle: null,
      ...overrides,
    };
  }

  function buildService(overrides: {
    trips?: any[];
    membership?: any;
    tenant?: any;
    updateManyImpl?: (args: any) => Promise<{ count: number }>;
  }) {
    const trips = (overrides.trips ?? [baseTrip()]).map((t) => ({ ...t }));
    const store = new Map(trips.map((t) => [t.id, { ...t }]));

    const tx = {
      trip: {
        updateMany: jest.fn(async (args: any) => {
          if (overrides.updateManyImpl) {
            return overrides.updateManyImpl(args);
          }
          const id = args.where.id as string;
          const row = store.get(id);
          if (!row) return { count: 0 };
          if (
            args.where.dispatchVersion != null &&
            (row.dispatchVersion ?? 1) !== args.where.dispatchVersion
          ) {
            return { count: 0 };
          }
          if (
            args.where.assignedDriverUserId != null &&
            row.assignedDriverUserId !== args.where.assignedDriverUserId &&
            !args.data.assignedDriverUserId
          ) {
            return { count: 0 };
          }
          if (args.data.dispatchSequence != null) {
            row.dispatchSequence = args.data.dispatchSequence;
          }
          if (args.data.assignedDriverUserId != null) {
            row.assignedDriverUserId = args.data.assignedDriverUserId;
          }
          if (args.data.dispatchVersion?.increment) {
            row.dispatchVersion =
              (row.dispatchVersion ?? 1) + args.data.dispatchVersion.increment;
          }
          // Never mutate job-local sequences in this mock path either.
          store.set(id, row);
          return { count: 1 };
        }),
        findMany: jest.fn(async (args: any) => {
          const ids: string[] = args?.where?.id?.in ?? [...store.keys()];
          return ids
            .map((id) => store.get(id))
            .filter(Boolean)
            .map((row) => ({
              id: row!.id,
              tripSequence: row!.tripSequence,
              jobSequence: row!.jobSequence,
              dispatchSequence: row!.dispatchSequence,
              dispatchVersion: row!.dispatchVersion,
            }));
        }),
      },
    };

    const prisma: any = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue(
          overrides.tenant ?? { timezone: "Asia/Singapore" },
        ),
      },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { user: { id: "drv1", name: "Driver One", phone: "1" } },
        ]),
        findFirst: jest.fn().mockResolvedValue(
          overrides.membership === undefined
            ? { userId: "drv1" }
            : overrides.membership,
        ),
      },
      trip: {
        findMany: jest.fn().mockImplementation(async (args: any = {}) => {
          let rows = [...store.values()];
          const idIn = args?.where?.id?.in as string[] | undefined;
          if (Array.isArray(idIn)) {
            rows = rows.filter((r) => idIn.includes(r.id));
          }
          const assigned = args?.where?.assignedDriverUserId;
          if (typeof assigned === "string") {
            rows = rows.filter((r) => r.assignedDriverUserId === assigned);
          }
          return rows;
        }),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: tx.trip.updateMany,
      },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "drow1",
            userId: "drv1",
            assignedVehicle: { plateNo: "SGA1234A" },
            assignedFleetVehicle: null,
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          id: "drow1",
          userId: "drv1",
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
        }),
      },
      vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      fleetVehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: (txClient: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const transportJobs = {
      assignTrip: jest.fn().mockResolvedValue({}),
      publishTrip: jest.fn().mockResolvedValue({}),
    };
    const realtime = {
      publishDispatchAndDashboard: jest.fn(),
    };
    const service = new DispatchRoutePlanningService(
      prisma,
      audit as any,
      transportJobs as any,
      realtime as any,
    );
    return { service, prisma, audit, transportJobs, realtime, store, tx };
  }

  it("getBoard exposes dispatchSequence/dispatchVersion and keeps display refs job-local", async () => {
    const { service } = buildService({
      trips: [
        baseTrip({
          tripSequence: 7,
          jobSequence: 3,
          dispatchSequence: 2,
          dispatchVersion: 4,
        }),
      ],
    });
    const board = await service.getBoard("tenant-1", "2026-08-20");
    expect(board.trips[0].dispatchSequence).toBe(2);
    expect(board.trips[0].dispatchVersion).toBe(4);
    expect(board.trips[0].tripSequence).toBe(7);
    expect(board.trips[0].tripDisplayRef).toContain("7");
    expect(board.lanes[0].planVersion).toBe(4);
  });

  it("savePlan does not modify tripSequence/jobSequence (sequence ownership regression)", async () => {
    const { service, store, tx } = buildService({
      trips: [
        baseTrip({
          id: "t1",
          tripSequence: 7,
          jobSequence: 3,
          dispatchSequence: 1,
          dispatchVersion: 1,
        }),
        baseTrip({
          id: "t2",
          tripSequence: 2,
          jobSequence: 1,
          dispatchSequence: 2,
          dispatchVersion: 1,
        }),
      ],
    });

    const result = await service.savePlan(
      "tenant-1",
      {
        date: "2026-08-20",
        driverUserId: "drv1",
        tripIdsInOrder: ["t2", "t1"],
        expectedPlanVersion: 2,
      },
      { userId: "admin-1" },
    );

    expect(result.preservedJobLocalSequences).toBe(true);
    expect(store.get("t1")!.tripSequence).toBe(7);
    expect(store.get("t1")!.jobSequence).toBe(3);
    expect(store.get("t2")!.tripSequence).toBe(2);
    expect(store.get("t1")!.dispatchSequence).toBe(2);
    expect(store.get("t2")!.dispatchSequence).toBe(1);
    for (const call of tx.trip.updateMany.mock.calls) {
      expect(call[0].data.tripSequence).toBeUndefined();
      expect(call[0].data.jobSequence).toBeUndefined();
      expect(call[0].data.routeVersion).toBeUndefined();
      expect(call[0].data.dispatchSequence).toBeDefined();
      expect(call[0].where.dispatchVersion).toBeDefined();
    }
  });

  it("savePlan CAS conflict returns 409 DISPATCH_PLAN_CONFLICT and writes nothing", async () => {
    const { service, store, audit, realtime } = buildService({
      trips: [baseTrip({ dispatchVersion: 5 })],
      updateManyImpl: async () => ({ count: 0 }),
    });

    await expect(
      service.savePlan(
        "tenant-1",
        {
          date: "2026-08-20",
          driverUserId: "drv1",
          tripIdsInOrder: ["t1"],
          expectedTripVersions: [{ tripId: "t1", dispatchVersion: 5 }],
        },
        { userId: "admin-1" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    try {
      await service.savePlan(
        "tenant-1",
        {
          date: "2026-08-20",
          driverUserId: "drv1",
          tripIdsInOrder: ["t1"],
          expectedTripVersions: [{ tripId: "t1", dispatchVersion: 5 }],
        },
        { userId: "admin-1" },
      );
    } catch (e: any) {
      expect(e.getResponse().code).toBe(DISPATCH_PLAN_CONFLICT_CODE);
    }

    expect(store.get("t1")!.dispatchSequence).toBe(1);
    expect(store.get("t1")!.dispatchVersion).toBe(5);
    expect(audit.log).not.toHaveBeenCalled();
    expect(realtime.publishDispatchAndDashboard).not.toHaveBeenCalled();
  });

  it("savePlan rolls back assignment+sequence when a later CAS fails (atomic)", async () => {
    let calls = 0;
    const { service, store, audit } = buildService({
      trips: [
        baseTrip({
          id: "t1",
          dispatchSequence: 1,
          dispatchVersion: 1,
          assignedDriverUserId: null,
        }),
        baseTrip({
          id: "t2",
          dispatchSequence: 2,
          dispatchVersion: 1,
          assignedDriverUserId: "drv1",
        }),
      ],
      updateManyImpl: async (args) => {
        calls += 1;
        // First trip would "succeed" outside a real DB; force second to fail and
        // rely on transaction abort semantics — simulated by throwing conflict.
        if (calls >= 2) {
          throw new ConflictException({
            code: DISPATCH_PLAN_CONFLICT_CODE,
            message: "stale",
          });
        }
        // Do not mutate store on success either — rollback simulation.
        void args;
        return { count: 1 };
      },
    });

    const before = {
      t1: { ...store.get("t1")! },
      t2: { ...store.get("t2")! },
    };

    await expect(
      service.savePlan(
        "tenant-1",
        {
          date: "2026-08-20",
          driverUserId: "drv1",
          tripIdsInOrder: ["t1", "t2"],
          assignments: [{ tripId: "t1", driverUserId: "drv1" }],
          expectedPlanVersion: 2,
        },
        { userId: "admin-1" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(store.get("t1")).toEqual(before.t1);
    expect(store.get("t2")).toEqual(before.t2);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("savePlan rejects moving an ONGOING trip from its absolute dispatch position", async () => {
    const { service } = buildService({
      trips: [
        baseTrip({
          id: "locked",
          status: TripStatus.ONGOING,
          dispatchSequence: 1,
          dispatchVersion: 1,
        }),
        baseTrip({
          id: "open",
          status: TripStatus.PUBLISHED,
          dispatchSequence: 2,
          dispatchVersion: 1,
        }),
      ],
    });

    await expect(
      service.savePlan(
        "tenant-1",
        {
          date: "2026-08-20",
          driverUserId: "drv1",
          tripIdsInOrder: ["open", "locked"],
          expectedPlanVersion: 2,
        },
        { userId: "admin-1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("savePlan allows reordering unlocked trips while locked stay fixed", async () => {
    const { service, store } = buildService({
      trips: [
        baseTrip({
          id: "locked",
          status: TripStatus.ONGOING,
          dispatchSequence: 1,
          dispatchVersion: 1,
          tripSequence: 1,
        }),
        baseTrip({
          id: "a",
          status: TripStatus.PUBLISHED,
          dispatchSequence: 2,
          dispatchVersion: 1,
          tripSequence: 5,
        }),
        baseTrip({
          id: "b",
          status: TripStatus.PUBLISHED,
          dispatchSequence: 3,
          dispatchVersion: 1,
          tripSequence: 2,
        }),
      ],
    });

    await service.savePlan(
      "tenant-1",
      {
        date: "2026-08-20",
        driverUserId: "drv1",
        tripIdsInOrder: ["locked", "b", "a"],
        expectedPlanVersion: 3,
      },
      { userId: "admin-1" },
    );

    expect(store.get("locked")!.dispatchSequence).toBe(1);
    expect(store.get("b")!.dispatchSequence).toBe(2);
    expect(store.get("a")!.dispatchSequence).toBe(3);
    expect(store.get("a")!.tripSequence).toBe(5);
  });

  it("savePlan rejects stale expectedPlanVersion before mutation", async () => {
    const { service, tx, audit } = buildService({
      trips: [baseTrip({ dispatchVersion: 3 })],
    });

    await expect(
      service.savePlan(
        "tenant-1",
        {
          date: "2026-08-20",
          driverUserId: "drv1",
          tripIdsInOrder: ["t1"],
          expectedPlanVersion: 1,
        },
        { userId: "admin-1" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.trip.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("savePlan rejects inactive/cross-tenant driver", async () => {
    const { service } = buildService({ membership: null });
    await expect(
      service.savePlan(
        "tenant-1",
        {
          date: "2026-08-20",
          driverUserId: "foreign-driver",
          tripIdsInOrder: ["t1"],
        },
        { userId: "admin-1" },
      ),
    ).rejects.toThrow(/Driver must belong to tenant/);
  });

  it("savePlan rejects incomplete lane membership", async () => {
    const { service } = buildService({
      trips: [
        baseTrip({ id: "t1" }),
        baseTrip({ id: "t2", dispatchSequence: 2 }),
      ],
    });
    await expect(
      service.savePlan(
        "tenant-1",
        {
          date: "2026-08-20",
          driverUserId: "drv1",
          tripIdsInOrder: ["t1"],
        },
        { userId: "admin-1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("savePlan does not call TransportJobsService.assignTrip (mutation stays in-tx)", async () => {
    const { service, transportJobs } = buildService({});
    await service.savePlan(
      "tenant-1",
      {
        date: "2026-08-20",
        driverUserId: "drv1",
        tripIdsInOrder: ["t1"],
        expectedPlanVersion: 1,
      },
      { userId: "admin-1" },
    );
    expect(transportJobs.assignTrip).not.toHaveBeenCalled();
  });

  it("publishPlan publishes DRAFT via TransportJobsService and skips others", async () => {
    const { service, transportJobs, audit, prisma } = buildService({});
    prisma.trip.findMany.mockResolvedValue([
      { id: "t-draft", jobId: "j1", status: TripStatus.DRAFT },
      { id: "t-pub", jobId: "j1", status: TripStatus.PUBLISHED },
    ]);

    const result = await service.publishPlan(
      "tenant-1",
      { date: "2026-08-20", tripIds: ["t-draft", "t-pub"] },
      { userId: "admin-1" },
    );
    expect(result.publishedTripIds).toEqual(["t-draft"]);
    expect(result.skipped[0].tripId).toBe("t-pub");
    expect(transportJobs.publishTrip).toHaveBeenCalledWith(
      "tenant-1",
      "j1",
      "t-draft",
      expect.anything(),
    );
    expect(audit.log).toHaveBeenCalledWith(
      "tenant-1",
      "DISPATCH_PLAN_PUBLISHED",
      "DISPATCH_PLAN",
      expect.any(String),
      expect.objectContaining({ publishedTripIds: ["t-draft"] }),
      "admin-1",
    );
  });
});
