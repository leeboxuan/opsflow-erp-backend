import { TripDocumentType } from "@prisma/client";

export type ContainerDocumentationMissingType =
  | typeof TripDocumentType.CONTAINER_PHOTO
  | typeof TripDocumentType.SEAL_PHOTO;

export type ContainerDocumentationRequirement = {
  jobItemId: string;
  containerNumber: string | null;
  sealNumber: string | null;
  hasContainerPhoto: boolean;
  hasSealPhoto: boolean;
  missing: ContainerDocumentationMissingType[];
};

export type ContainerDocumentationItemRow = {
  id: string;
  itemCode?: string | null;
  sealNo?: string | null;
};

export type ContainerDocumentationDocumentRow = {
  type: TripDocumentType;
  jobItemId?: string | null;
  isActive?: boolean | null;
};

/**
 * Builds requirements by stable JobItem id. Counts are intentionally irrelevant:
 * repeated photos for one item cannot satisfy another item.
 */
export function buildContainerDocumentationRequirements(
  items: ContainerDocumentationItemRow[],
  documents: ContainerDocumentationDocumentRow[],
): ContainerDocumentationRequirement[] {
  const activeDocuments = documents.filter((document) => document.isActive !== false);

  return items.map((item) => {
    const itemDocuments = activeDocuments.filter(
      (document) => document.jobItemId === item.id,
    );
    const hasContainerPhoto = itemDocuments.some(
      (document) => document.type === TripDocumentType.CONTAINER_PHOTO,
    );
    const hasSealPhoto = itemDocuments.some(
      (document) => document.type === TripDocumentType.SEAL_PHOTO,
    );
    const missing: ContainerDocumentationMissingType[] = [];
    if (!hasContainerPhoto) missing.push(TripDocumentType.CONTAINER_PHOTO);
    if (!hasSealPhoto) missing.push(TripDocumentType.SEAL_PHOTO);

    return {
      jobItemId: item.id,
      containerNumber: normalizeNullableText(item.itemCode),
      sealNumber: normalizeNullableText(item.sealNo),
      hasContainerPhoto,
      hasSealPhoto,
      missing,
    };
  });
}

export function getMissingContainerDocumentTypes(
  requirements: ContainerDocumentationRequirement[],
): ContainerDocumentationMissingType[] {
  const missing = new Set<ContainerDocumentationMissingType>();
  for (const requirement of requirements) {
    for (const type of requirement.missing) missing.add(type);
  }
  return [...missing];
}

export function containerDocumentationErrorLabels(
  incomplete: ContainerDocumentationRequirement[],
  allRequirements: ContainerDocumentationRequirement[] = incomplete,
): string[] {
  return incomplete.map((requirement) => {
    const rowIndex = allRequirements.findIndex(
      (candidate) => candidate.jobItemId === requirement.jobItemId,
    );
    return requirement.containerNumber ?? `Container ${Math.max(rowIndex, 0) + 1}`;
  });
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
