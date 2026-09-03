/**
 * Canonical TripJobItem mutation helpers (Prisma-aware).
 * All ordinary create/replace/delete of links MUST go through these so
 * COMPLETED/DONE freeze is enforced in the backend, not only the UI.
 */

import { BadRequestException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import {
  assertTripJobItemMutable,
  buildTripJobItemCreateRows,
  normalizeJobItemIdsInput,
  resolveSyncedTripContainerNumber,
  type JobItemRowForLink,
} from "./trip-job-item.helpers";

type TripJobItemDelegate = {
  findMany: (args: any) => Promise<any[]>;
  deleteMany: (args: any) => Promise<any>;
  createMany: (args: any) => Promise<any>;
};

type PrismaLike = {
  $transaction?: <T>(fn: (tx: PrismaLike) => Promise<T>) => Promise<T>;
  tripJobItem: TripJobItemDelegate;
  jobItem: {
    findMany: (args: any) => Promise<JobItemRowForLink[]>;
  };
  trip: {
    update: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
  };
};

async function runInTransactionIfAvailable<T>(
  prisma: PrismaLike,
  fn: (client: PrismaLike) => Promise<T>,
): Promise<T> {
  if (typeof prisma.$transaction === "function") {
    return prisma.$transaction((tx) => fn(tx));
  }
  return fn(prisma);
}

export async function loadTripJobItemLinks(
  prisma: PrismaLike,
  tenantId: string,
  tripId: string,
): Promise<
  Array<{
    id: string;
    jobItemId: string;
    containerNumberSnapshot: string | null;
    jobItem: {
      id: string;
      itemCode: string;
      description: string | null;
      sealNo: string | null;
      pickupReference: string | null;
      qty: number | null;
    };
  }>
> {
  if (!prisma?.tripJobItem?.findMany) return [];
  return prisma.tripJobItem.findMany({
    where: { tenantId, tripId },
    orderBy: [{ linkedAt: "asc" }, { createdAt: "asc" }],
    include: {
      jobItem: {
        select: {
          id: true,
          itemCode: true,
          description: true,
          sealNo: true,
          containerSize: true,
          pickupReference: true,
          qty: true,
        },
      },
    },
  });
}

async function resolveJobItemsForLinkIds(
  prisma: PrismaLike,
  input: { tenantId: string; jobId: string; jobItemIds: string[] },
): Promise<JobItemRowForLink[]> {
  const ids = normalizeJobItemIdsInput(input.jobItemIds);
  if (ids.length === 0) return [];

  const items = await prisma.jobItem.findMany({
    where: {
      tenantId: input.tenantId,
      jobId: input.jobId,
      id: { in: ids },
    },
    select: {
      id: true,
      itemCode: true,
      description: true,
      sealNo: true,
      containerSize: true,
      pickupReference: true,
      qty: true,
    },
  });
  if (items.length !== ids.length) {
    throw new BadRequestException(
      "One or more jobItemIds do not belong to this job and tenant",
    );
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

/**
 * Hard-delete existing links and create the new set. Frozen COMPLETED/DONE trips reject.
 * Validates jobItemIds before any delete. deleteMany + createMany + containerNumber
 * update run in a single transaction when `$transaction` is available.
 */
export async function replaceTripJobItemLinks(
  prisma: PrismaLike,
  input: {
    tenantId: string;
    tripId: string;
    jobId: string;
    tripStatus: TripStatus | string;
    previousContainerNumber?: string | null;
    jobItemIds: string[];
    linkedByUserId?: string | null;
  },
): Promise<{ linkedCount: number; containerNumber: string | null }> {
  try {
    assertTripJobItemMutable(input.tripStatus);
  } catch (e: any) {
    throw new BadRequestException(e?.message ?? "TripJobItem links are frozen");
  }

  // Validate ownership BEFORE any destructive write.
  const items = await resolveJobItemsForLinkIds(prisma, {
    tenantId: input.tenantId,
    jobId: input.jobId,
    jobItemIds: input.jobItemIds,
  });

  const containerNumber = resolveSyncedTripContainerNumber(
    items,
    input.previousContainerNumber,
  );
  const nextContainer = items.length === 0 ? null : containerNumber;

  await runInTransactionIfAvailable(prisma, async (tx) => {
    await tx.tripJobItem.deleteMany({
      where: { tenantId: input.tenantId, tripId: input.tripId },
    });

    if (items.length > 0) {
      await tx.tripJobItem.createMany({
        data: buildTripJobItemCreateRows({
          tenantId: input.tenantId,
          tripId: input.tripId,
          items,
          linkedByUserId: input.linkedByUserId ?? null,
        }),
      });
    }

    await tx.trip.update({
      where: { id: input.tripId },
      data: { containerNumber: nextContainer },
    });
  });

  return { linkedCount: items.length, containerNumber: nextContainer };
}

/** Create links without deleting others (idempotent per unique constraint). */
export async function createTripJobItemLinksIfAbsent(
  prisma: PrismaLike,
  input: {
    tenantId: string;
    tripId: string;
    jobId: string;
    tripStatus: TripStatus | string;
    previousContainerNumber?: string | null;
    jobItemIds: string[];
    linkedByUserId?: string | null;
  },
): Promise<{ created: number; total: number; containerNumber: string | null }> {
  try {
    assertTripJobItemMutable(input.tripStatus);
  } catch (e: any) {
    throw new BadRequestException(e?.message ?? "TripJobItem links are frozen");
  }

  const ids = normalizeJobItemIdsInput(input.jobItemIds);
  if (ids.length === 0) {
    return {
      created: 0,
      total: 0,
      containerNumber: input.previousContainerNumber ?? null,
    };
  }

  const items = await resolveJobItemsForLinkIds(prisma, {
    tenantId: input.tenantId,
    jobId: input.jobId,
    jobItemIds: ids,
  });

  const existing = await prisma.tripJobItem.findMany({
    where: { tenantId: input.tenantId, tripId: input.tripId },
    select: { jobItemId: true },
  });
  const existingSet = new Set(existing.map((r) => r.jobItemId));
  const toCreate = items.filter((i) => !existingSet.has(i.id));

  await runInTransactionIfAvailable(prisma, async (tx) => {
    if (toCreate.length > 0) {
      await tx.tripJobItem.createMany({
        data: buildTripJobItemCreateRows({
          tenantId: input.tenantId,
          tripId: input.tripId,
          items: toCreate,
          linkedByUserId: input.linkedByUserId ?? null,
        }),
        skipDuplicates: true,
      });
    }

    const allLinks = await loadTripJobItemLinks(tx, input.tenantId, input.tripId);
    const containerNumber = resolveSyncedTripContainerNumber(
      allLinks.map((l) => l.jobItem),
      input.previousContainerNumber,
    );
    await tx.trip.update({
      where: { id: input.tripId },
      data: { containerNumber },
    });
  });

  const finalLinks = await loadTripJobItemLinks(prisma, input.tenantId, input.tripId);
  const containerNumber = resolveSyncedTripContainerNumber(
    finalLinks.map((l) => l.jobItem),
    input.previousContainerNumber,
  );

  return {
    created: toCreate.length,
    total: finalLinks.length,
    containerNumber,
  };
}

/** Assert jobItemId is explicitly linked to the trip (no unlinked JobItem fallback). */
export async function assertJobItemLinkedToTrip(
  prisma: PrismaLike,
  tenantId: string,
  tripId: string,
  jobItemId: string,
): Promise<void> {
  if (!prisma?.tripJobItem?.findMany) {
    throw new BadRequestException(
      "jobItemId is not linked to this trip via TripJobItem. Explicit cargo linkage is required for uploads.",
    );
  }
  const links = await prisma.tripJobItem.findMany({
    where: { tenantId, tripId, jobItemId },
    select: { id: true },
    take: 1,
  });
  if (links.length === 0) {
    throw new BadRequestException(
      "jobItemId is not linked to this trip via TripJobItem. Explicit cargo linkage is required for uploads.",
    );
  }
}

type PrismaWithTripJobItemLookup = {
  tripJobItem?: {
    findMany: (args: any) => Promise<
      Array<{
        jobItemId: string;
        tripId: string;
        trip?: { id: string; status: string } | null;
      }>
    >;
  };
};

/**
 * Reject JobItem deletion/replacement when any affected JobItem is linked to a
 * COMPLETED or DONE trip. Must run before destructive writes (same transaction preferred).
 */
export async function assertJobItemsNotLinkedToFrozenTrips(
  prisma: PrismaWithTripJobItemLookup,
  input: {
    tenantId: string;
    jobItemIds: string[];
  },
): Promise<void> {
  const ids = normalizeJobItemIdsInput(input.jobItemIds);
  if (ids.length === 0) return;
  if (!prisma?.tripJobItem?.findMany) {
    throw new BadRequestException(
      "TripJobItem lookup is unavailable; refusing JobItem deletion/replacement that could detach frozen COMPLETED/DONE links.",
    );
  }

  const links = await prisma.tripJobItem.findMany({
    where: {
      tenantId: input.tenantId,
      jobItemId: { in: ids },
      trip: {
        status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
      },
    },
    select: {
      jobItemId: true,
      tripId: true,
      trip: { select: { id: true, status: true } },
    },
  });

  if (links.length === 0) return;

  const frozenTripIds = [
    ...new Set(links.map((l) => l.tripId || l.trip?.id).filter(Boolean)),
  ];
  throw new BadRequestException(
    `Cannot delete or replace JobItem(s) linked to COMPLETED/DONE trip(s): ${frozenTripIds.join(", ")}. ` +
      "Frozen TripJobItem relationships must not be detached or recreated with new JobItem IDs.",
  );
}

/**
 * Apply job-item update semantics for an existing job.
 *
 * - replaceItems=false (default for operational trip edits):
 *   - rows with id → update only those rows (siblings preserved)
 *   - rows without id → create
 *   - never delete siblings; empty array clears only when replaceItems=true or explicit clear
 * - replaceItems=true (job-level cargo replace / LCL full list):
 *   - omitted existing ids → delete when freeze guard permits
 *   - id-less payload against existing items → rejected
 */
export async function applyJobItemsUpdateInTransaction(
  tx: {
    jobItem: {
      findMany: (args: any) => Promise<Array<{ id: string }>>;
      deleteMany: (args: any) => Promise<any>;
      createMany: (args: any) => Promise<any>;
      create: (args: any) => Promise<any>;
      update: (args: any) => Promise<any>;
    };
    tripJobItem?: PrismaWithTripJobItemLookup["tripJobItem"];
  },
  input: {
    tenantId: string;
    jobId: string;
    validItems: Array<{
      id: string | null;
      itemCode: string;
      description: string | null;
      sealNo: string | null;
      containerSize: import("@prisma/client").ContainerSize | null;
      pickupReference: string | null;
      qty: number | null;
    }>;
    /** When true, omitted existing JobItems are deleted (freeze-guarded). */
    replaceItems?: boolean;
  },
): Promise<void> {
  const { tenantId, jobId, validItems } = input;
  const replaceItems = input.replaceItems === true;
  const retainedIds = validItems
    .map((item) => item.id)
    .filter((id): id is string => !!id);

  const existing = await tx.jobItem.findMany({
    where: { tenantId, jobId },
    select: { id: true },
  });
  const existingIds = existing.map((row) => row.id);

  if (!retainedIds.length) {
    if (existingIds.length > 0 && validItems.length > 0) {
      throw new BadRequestException(
        "JobItem updates must include stable item ids when the job already has cargo. " +
          "Send id on each existing row; do not replace the full cargo manifest with an id-less payload.",
      );
    }
    if (existingIds.length > 0) {
      // Explicit clear-all (empty payload).
      await assertJobItemsNotLinkedToFrozenTrips(tx, {
        tenantId,
        jobItemIds: existingIds,
      });
      await tx.jobItem.deleteMany({ where: { tenantId, jobId } });
    }
    if (validItems.length > 0) {
      await tx.jobItem.createMany({
        data: validItems.map((item) => ({
          tenantId,
          jobId,
          itemCode: item.itemCode,
          description: item.description,
          sealNo: item.sealNo,
          containerSize: item.containerSize,
          pickupReference: item.pickupReference,
          qty: item.qty,
        })),
      });
    }
    return;
  }

  const found = await tx.jobItem.findMany({
    where: { tenantId, jobId, id: { in: retainedIds } },
    select: { id: true },
  });
  if (found.length !== retainedIds.length) {
    throw new BadRequestException(
      "One or more item ids do not belong to this job",
    );
  }

  const patchOnly = !replaceItems && validItems.every((item) => !!item.id);

  if (!patchOnly) {
    const toDelete = existingIds.filter((id) => !retainedIds.includes(id));
    if (toDelete.length > 0) {
      await assertJobItemsNotLinkedToFrozenTrips(tx, {
        tenantId,
        jobItemIds: toDelete,
      });
      await tx.jobItem.deleteMany({
        where: { tenantId, jobId, id: { in: toDelete } },
      });
    }
  }

  for (const item of validItems) {
    const itemData = {
      itemCode: item.itemCode,
      description: item.description,
      sealNo: item.sealNo,
      containerSize: item.containerSize,
      pickupReference: item.pickupReference,
      qty: item.qty,
    };
    if (item.id) {
      await tx.jobItem.update({
        where: { id: item.id },
        data: itemData,
      });
    } else if (!patchOnly) {
      await tx.jobItem.create({
        data: { tenantId, jobId, ...itemData },
      });
    }
  }
}
