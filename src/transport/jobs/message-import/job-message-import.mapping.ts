import { JobStatus, JobType } from "@prisma/client";
import {
  assertCreateJobItemsRequiredForJobType,
  assertDeliveryLocationForCreate,
  assertImportPickupSourceForCreate,
  assertPickupLocationForCreate,
  parseValidJobItemsFromInput,
  resolveCollectionTypeForJobCreate,
  resolveExportDestinationFields,
  resolveExportPickupFields,
} from "../create-job-validation.helpers";
import { movementTypeToJobType } from "./job-message-import.validator";
import type { ControllerReviewedDraft } from "./job-message-import.types";

export type CanonicalJobCreateData = {
  jobType: JobType;
  collectionType: ReturnType<typeof resolveCollectionTypeForJobCreate>;
  customerCompanyId: string;
  pickupDate: Date;
  pickupAddress1: string;
  deliveryAddress1: string;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  receiverName: string;
  receiverPhone: string;
  description: string | null;
  notes: string | null;
  carrierName: string | null;
  shipper: string | null;
  vesselName: string | null;
  voyage: string | null;
  status: typeof JobStatus.ONGOING;
  items: Array<{
    itemCode: string;
    description: string | null;
    sealNo: string | null;
    pickupReference: string | null;
    qty: number | null;
  }>;
};

function composeNotes(reviewed: ControllerReviewedDraft): string | null {
  const parts: string[] = [];
  if (reviewed.timingText) parts.push(reviewed.timingText);
  for (const i of reviewed.instructions) parts.push(i);
  if (reviewed.notes) parts.push(reviewed.notes);
  const out = parts.map((p) => p.trim()).filter(Boolean).join("\n");
  return out || null;
}

/**
 * Maps the controller-reviewed draft to canonical Job + JobItem create data.
 * Reuses existing create-job validation helpers. Never reads parsedJson.
 */
export function reviewedDraftToCanonicalJobCreate(input: {
  reviewed: ControllerReviewedDraft;
  serviceDate: Date;
}): CanonicalJobCreateData {
  const reviewed = input.reviewed;
  const jobType = movementTypeToJobType(reviewed.movementType);
  if (!jobType) {
    throw new Error("UNKNOWN_MOVEMENT_TYPE");
  }
  if (!reviewed.customerCompanyId) {
    throw new Error("MISSING_CUSTOMER");
  }
  if (!reviewed.pickupAddress1 || !reviewed.deliveryAddress1) {
    throw new Error("MISSING_LOCATION");
  }

  const collectionType =
    jobType === JobType.COLLECTION
      ? resolveCollectionTypeForJobCreate(jobType, reviewed.collectionType)
      : null;

  const mappedItems = reviewed.items.map((it) =>
    jobType === JobType.LCL
      ? {
          itemCode: it.referenceNumber || it.containerNumber,
          qty: it.quantity ?? 1,
          sealNo: it.sealNumber,
        }
      : {
          containerNumber: it.containerNumber || it.referenceNumber,
          sealNo: it.sealNumber,
          qty: it.quantity,
        },
  );
  const validItems = parseValidJobItemsFromInput(mappedItems, jobType);
  assertCreateJobItemsRequiredForJobType(jobType, mappedItems, validItems);

  if (jobType === JobType.IMPORT) {
    assertImportPickupSourceForCreate({
      pickupPortCode: null,
      pickupAddress1: reviewed.pickupAddress1,
      pickupPlaceId: null,
    });
    assertDeliveryLocationForCreate({
      jobType: JobType.IMPORT,
      deliveryAddress1: reviewed.deliveryAddress1,
      deliveryPlaceId: null,
    });
  } else if (jobType === JobType.EXPORT) {
    const exportPickup = resolveExportPickupFields({
      pickupAddress1: reviewed.pickupAddress1,
    });
    assertPickupLocationForCreate({
      jobType: JobType.EXPORT,
      pickupAddress1: exportPickup.address1,
      pickupPlaceId: null,
    });
    assertDeliveryLocationForCreate({
      jobType: JobType.EXPORT,
      deliveryAddress1: reviewed.deliveryAddress1,
      deliveryPlaceId: null,
      stuffingAddress1: null,
    });
    void resolveExportDestinationFields({
      deliveryAddress1: reviewed.deliveryAddress1,
    });
  } else {
    assertPickupLocationForCreate({
      jobType,
      pickupAddress1: reviewed.pickupAddress1,
      pickupPlaceId: null,
    });
    assertDeliveryLocationForCreate({
      jobType,
      deliveryAddress1: reviewed.deliveryAddress1,
      deliveryPlaceId: null,
    });
  }

  return {
    jobType,
    collectionType,
    customerCompanyId: reviewed.customerCompanyId,
    pickupDate: new Date(input.serviceDate),
    pickupAddress1: reviewed.pickupAddress1,
    deliveryAddress1: reviewed.deliveryAddress1,
    pickupContactName: reviewed.picName,
    pickupContactPhone: reviewed.picPhone,
    // Manual Job.create persists omitted receiver contact as "" (required String columns).
    receiverName: reviewed.picName ?? "",
    receiverPhone: reviewed.picPhone ?? "",
    description: reviewed.timingText,
    notes: composeNotes(reviewed),
    carrierName: reviewed.carrierName,
    shipper: reviewed.shipper,
    vesselName: reviewed.vesselName,
    voyage: reviewed.voyage,
    status: JobStatus.ONGOING,
    items: validItems,
  };
}
