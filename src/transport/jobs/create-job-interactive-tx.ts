/**
 * Fail-closed validation for the interactive Prisma transaction client used by
 * TransportJobsService.create (job + items + trips + TripJobItem links).
 */

export function assertCreateJobInteractiveTxClient(tx: unknown): void {
  const client = tx as {
    job?: { create?: unknown };
    trip?: { createMany?: unknown; findMany?: unknown; update?: unknown };
    jobItem?: { findMany?: unknown };
    tripJobItem?: { findMany?: unknown; createMany?: unknown };
  } | null;

  const required: Array<[string, unknown]> = [
    ["job.create", client?.job?.create],
    ["trip.createMany", client?.trip?.createMany],
    ["trip.findMany", client?.trip?.findMany],
    ["trip.update", client?.trip?.update],
    ["jobItem.findMany", client?.jobItem?.findMany],
    ["tripJobItem.findMany", client?.tripJobItem?.findMany],
    ["tripJobItem.createMany", client?.tripJobItem?.createMany],
  ];

  const missing = required
    .filter(([, value]) => typeof value !== "function")
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Interactive transaction client is incomplete for job creation; missing: ${missing.join(", ")}. ` +
        "Refusing to create job/trips/links outside a complete interactive transaction.",
    );
  }
}

export function assertPrismaInteractiveTransactionAvailable(prisma: {
  $transaction?: unknown;
}): void {
  if (typeof prisma?.$transaction !== "function") {
    throw new Error(
      "Prisma interactive $transaction is unavailable. " +
        "Job creation requires an interactive transaction and will not fall back to non-transactional writes.",
    );
  }
}
