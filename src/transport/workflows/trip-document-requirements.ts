import {
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";

export type TripDocumentRequirementSnapshot = {
  id?: string | null;
  type: TripDocumentType | string;
  label?: string | null;
  isRequired: boolean;
  requiresSignature: boolean;
  minCount?: number | null;
  sortOrder?: number | null;
  responsibleUploader?: TripDocumentResponsibleUploader | string | null;
  requirementStage?: TripDocumentRequirementStage | string | null;
};

const SIGNATURE_CAPABLE_TYPES = new Set<string>([
  TripDocumentType.DELIVERY_DO,
  TripDocumentType.PICKUP_DO,
  TripDocumentType.LORRY_CHIT,
]);

const COMPLETION_SNAPSHOT_SKIP_TYPES = new Set<string>([
  TripDocumentType.CONTAINER_PHOTO,
  TripDocumentType.SEAL_PHOTO,
  TripDocumentType.TRAILER_START_PHOTO,
  TripDocumentType.TRAILER_END_PHOTO,
  TripDocumentType.POD_SIGNATURE,
]);

export function documentTypeSupportsCustomerSignature(
  type?: string | null,
): boolean {
  const key = String(type ?? "")
    .trim()
    .toUpperCase();
  return SIGNATURE_CAPABLE_TYPES.has(key);
}

export function isTripDocumentRequirementFrozen(
  status?: TripStatus | string | null,
): boolean {
  const token = String(status ?? "")
    .trim()
    .toUpperCase();
  return token.length > 0 && token !== TripStatus.DRAFT;
}

export function defaultTripDocumentRequirementRows(
  tenantId: string,
  tripId: string,
): Array<{
  tenantId: string;
  tripId: string;
  type: TripDocumentType;
  label: string;
  isRequired: boolean;
  requiresSignature: boolean;
  minCount: number;
  sortOrder: number;
  responsibleUploader: TripDocumentResponsibleUploader;
  requirementStage: TripDocumentRequirementStage;
}> {
  return [
    {
      tenantId,
      tripId,
      type: TripDocumentType.POD_PHOTO,
      label: "Proof of Delivery Photo",
      isRequired: true,
      requiresSignature: false,
      minCount: 1,
      sortOrder: 0,
      responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
      requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
    },
  ];
}

export function tripDocumentRequirementRowsForCreate(
  tenantId: string,
  tripId: string,
  flags?: {
    signedDeliveryDoRequired?: boolean;
    signedLorryChitRequired?: boolean;
  } | null,
): ReturnType<typeof defaultTripDocumentRequirementRows> {
  const rows = defaultTripDocumentRequirementRows(tenantId, tripId);
  if (flags?.signedDeliveryDoRequired === true) {
    rows.push({
      tenantId,
      tripId,
      type: TripDocumentType.DELIVERY_DO,
      label: "Delivery DO",
      isRequired: true,
      requiresSignature: true,
      minCount: 1,
      sortOrder: 1,
      responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
      requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
    });
  }
  if (flags?.signedLorryChitRequired === true) {
    rows.push({
      tenantId,
      tripId,
      type: TripDocumentType.LORRY_CHIT,
      label: "Lorry Chit",
      isRequired: true,
      requiresSignature: true,
      minCount: 1,
      sortOrder: 2,
      responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
      requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
    });
  }
  return rows;
}

export async function seedTripDocumentRequirementsForCreate(
  prisma: unknown,
  tenantId: string,
  trips: Array<{
    tripId: string;
    signedDeliveryDoRequired?: boolean;
    signedLorryChitRequired?: boolean;
  }>,
): Promise<void> {
  const delegate = (prisma as { tripDocumentRequirement?: RequirementDelegate | null })
    .tripDocumentRequirement;
  if (!delegate?.createMany) return;
  const data = trips.flatMap((trip) =>
    tripDocumentRequirementRowsForCreate(tenantId, trip.tripId, trip),
  );
  if (data.length === 0) return;
  await delegate.createMany({ data });
}

type RequirementDelegate = {
  findMany: (args: unknown) => Promise<Array<{ tripId: string }>>;
  createMany: (args: unknown) => Promise<unknown>;
};

/**
 * Insert default per-trip requirement snapshots only when the trip has none.
 * Existing rows are never updated (published and draft snapshots stay frozen
 * against later default/template changes).
 */
export async function ensureDefaultTripDocumentRequirementSnapshots(
  prisma: unknown,
  tenantId: string,
  tripIds: string[],
): Promise<void> {
  const delegate = (prisma as { tripDocumentRequirement?: RequirementDelegate | null })
    .tripDocumentRequirement;
  if (!delegate?.findMany || !delegate?.createMany) return;
  const ids = tripIds.filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return;

  const existing = await delegate.findMany({
    where: { tenantId, tripId: { in: ids } },
    select: { tripId: true },
  });
  const alreadySeeded = new Set(existing.map((row) => row.tripId));
  const data = ids
    .filter((tripId) => !alreadySeeded.has(tripId))
    .flatMap((tripId) => defaultTripDocumentRequirementRows(tenantId, tripId));
  if (data.length === 0) return;
  await delegate.createMany({ data });
}

export function shouldSkipCompletionSnapshotType(
  type?: string | null,
): boolean {
  const key = String(type ?? "")
    .trim()
    .toUpperCase();
  return COMPLETION_SNAPSHOT_SKIP_TYPES.has(key);
}

export function requirementSnapshotForType(
  requirements: TripDocumentRequirementSnapshot[] | null | undefined,
  type?: string | null,
): TripDocumentRequirementSnapshot | null {
  const key = String(type ?? "")
    .trim()
    .toUpperCase();
  if (!key) return null;
  return (
    (requirements ?? []).find(
      (row) =>
        String(row.type ?? "")
          .trim()
          .toUpperCase() === key,
    ) ?? null
  );
}

export function groupTripDocumentRequirementSnapshots(
  rows: Array<{
    tripId: string;
    id?: string | null;
    type: string;
    label?: string | null;
    isRequired: boolean;
    requiresSignature: boolean;
    minCount?: number | null;
    sortOrder?: number | null;
    responsibleUploader?: string | null;
    requirementStage?: string | null;
  }>,
): Map<string, TripDocumentRequirementSnapshot[]> {
  const grouped = new Map<string, TripDocumentRequirementSnapshot[]>();
  for (const row of rows) {
    const list = grouped.get(row.tripId) ?? [];
    list.push({
      id: row.id ?? null,
      type: row.type,
      label: row.label ?? null,
      isRequired: row.isRequired,
      requiresSignature: row.requiresSignature,
      minCount: row.minCount ?? 1,
      sortOrder: row.sortOrder ?? 0,
      responsibleUploader: row.responsibleUploader ?? TripDocumentResponsibleUploader.DRIVER,
      requirementStage:
        row.requirementStage ?? TripDocumentRequirementStage.BEFORE_COMPLETE,
    });
    grouped.set(row.tripId, list);
  }
  return grouped;
}

export async function loadTripDocumentRequirementSnapshotsByTrip(
  prisma: unknown,
  tenantId: string,
  tripIds: string[],
): Promise<Map<string, TripDocumentRequirementSnapshot[]>> {
  const ids = tripIds.filter((id) => typeof id === "string" && id.length > 0);
  const delegate = (prisma as {
    tripDocumentRequirement?: {
      findMany: (args: unknown) => Promise<
        Array<{
          tripId: string;
          id: string;
          type: string;
          label: string;
          isRequired: boolean;
          requiresSignature: boolean;
          minCount: number;
          sortOrder: number;
          responsibleUploader: string;
          requirementStage: string;
        }>
      >;
    } | null;
  }).tripDocumentRequirement;
  if (ids.length === 0 || !delegate?.findMany) {
    return new Map();
  }
  const rows = await delegate.findMany({
    where: { tenantId, tripId: { in: ids } },
    select: {
      tripId: true,
      id: true,
      type: true,
      label: true,
      isRequired: true,
      requiresSignature: true,
      minCount: true,
      sortOrder: true,
      responsibleUploader: true,
      requirementStage: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return groupTripDocumentRequirementSnapshots(rows);
}
