/**
 * Shared mock helper for Prisma interactive `$transaction` in unit tests.
 * Production create paths require a complete transaction-shaped client — no root fallback.
 */

export type InteractiveTxShape = {
  job: { create: jest.Mock };
  trip: {
    createMany: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  jobItem: { create: jest.Mock; findMany: jest.Mock };
  tripJobItem: {
    findMany: jest.Mock;
    createMany: jest.Mock;
  };
  jobTypeAssignment: { createMany: jest.Mock };
};

/**
 * Wraps a root prisma mock so `$transaction(fn)` invokes `fn` with a complete
 * interactive-tx client (defaults to the same root object when it already has
 * the required delegates).
 */
export function withInteractiveTransaction(
  prisma: any,
  txClient?: Partial<InteractiveTxShape> & Record<string, unknown>,
): any {
  const tx = buildInteractiveTxClient(prisma, txClient);
  return {
    ...prisma,
    $transaction: jest.fn(async (input: any) => {
      if (typeof input === "function") {
        return input(tx);
      }
      // Array / batch form — pass through for non-create tests.
      return Promise.all(input);
    }),
  };
}

export function buildInteractiveTxClient(
  root: any,
  overrides?: Partial<InteractiveTxShape> & Record<string, unknown>,
): any {
  const {
    job: jobOverride,
    trip: tripOverride,
    jobItem: jobItemOverride,
    tripJobItem: tripJobItemOverride,
    jobTypeAssignment: jobTypeAssignmentOverride,
    ...restOverrides
  } = overrides ?? {};

  return {
    job: {
      create: root?.job?.create ?? jest.fn(),
      findFirst: root?.job?.findFirst,
      findMany: root?.job?.findMany,
      update: root?.job?.update,
      count: root?.job?.count,
      ...(jobOverride ?? {}),
    },
    trip: {
      createMany: root?.trip?.createMany ?? jest.fn(),
      findMany: root?.trip?.findMany ?? jest.fn().mockResolvedValue([]),
      findFirst: root?.trip?.findFirst,
      update: root?.trip?.update ?? jest.fn().mockResolvedValue({}),
      ...(tripOverride ?? {}),
    },
    jobItem: {
      create: root?.jobItem?.create ?? jest.fn(),
      findMany:
        root?.jobItem?.findMany
        ?? jest.fn().mockResolvedValue([]),
      ...(jobItemOverride ?? {}),
    },
    tripJobItem: {
      findMany:
        root?.tripJobItem?.findMany
        ?? jest.fn().mockResolvedValue([]),
      createMany:
        root?.tripJobItem?.createMany
        ?? jest.fn().mockResolvedValue({ count: 0 }),
      count: root?.tripJobItem?.count,
      ...(tripJobItemOverride ?? {}),
    },
    jobTypeAssignment: {
      createMany:
        root?.jobTypeAssignment?.createMany
        ?? jest.fn().mockResolvedValue({ count: 0 }),
      findMany: root?.jobTypeAssignment?.findMany,
      deleteMany: root?.jobTypeAssignment?.deleteMany,
      ...(jobTypeAssignmentOverride ?? {}),
    },
    ...restOverrides,
  };
}

/** Assert production create path required delegates (mirrors service validation). */
export function assertCreateJobInteractiveTxClientForTest(tx: any): void {
  const required: Array<[string, unknown]> = [
    ["job.create", tx?.job?.create],
    ["trip.createMany", tx?.trip?.createMany],
    ["trip.findMany", tx?.trip?.findMany],
    ["trip.update", tx?.trip?.update],
    ["jobItem.create", tx?.jobItem?.create],
    ["jobItem.findMany", tx?.jobItem?.findMany],
    ["tripJobItem.findMany", tx?.tripJobItem?.findMany],
    ["tripJobItem.createMany", tx?.tripJobItem?.createMany],
    ["jobTypeAssignment.createMany", tx?.jobTypeAssignment?.createMany],
  ];
  const missing = required.filter(([, v]) => typeof v !== "function").map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Interactive transaction client is incomplete; missing: ${missing.join(", ")}`,
    );
  }
}
