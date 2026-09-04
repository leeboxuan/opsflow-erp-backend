import { JobStatus, JobType } from "@prisma/client";
import type { CreateJobDto } from "../dto/create-job.dto";
import {
  assertCreateJobItemsRequiredForJobType,
  ensureCollectionJobItems,
  parseValidJobItemsFromInput,
  resolveCollectionTypeForJobCreate,
} from "../create-job-validation.helpers";
import {
  assertCanonicalRouteLocationsForCreate,
  resolveCanonicalRouteLocations,
} from "../job-route-locations";
import { resolveReturnDestinationFields } from "../return-destination";
import {
  movementTypeToJobType,
  trimToNull,
} from "./job-message-import.validator";
import type { ControllerReviewedDraft } from "./job-message-import.types";
import {
  collectionPickupReferenceFromReviewed,
  mapReviewedItemsForParse,
} from "./job-message-import.items-map";
import { zonedLocalDateTimeToUtc } from "./job-message-import.timing";
import { requestedLocalHasTime } from "../requested-timing";

export type CanonicalJobCreateData = {
  jobType: JobType;
  collectionType: ReturnType<typeof resolveCollectionTypeForJobCreate>;
  customerCompanyId: string;
  pickupDate: Date | null;
  pickupDateHasTime?: boolean | null;
  deliveryDate: Date | null;
  deliveryDateHasTime?: boolean | null;
  pickupAddress1: string;
  pickupAddress2: string | null;
  pickupPostal: string | null;
  deliveryAddress1: string;
  deliveryAddress2: string | null;
  deliveryPostal: string | null;
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
    itemCode: string | null;
    description: string | null;
    sealNo: string | null;
    pickupReference: string | null;
    qty: number | null;
  }>;
};

function composeNotes(reviewed: ControllerReviewedDraft): string | null {
  const parts: string[] = [];
  if (reviewed.timingText) parts.push(reviewed.timingText);
  // Structured pickup/delivery timing persists on Job.pickupDate / Job.deliveryDate —
  // do not duplicate them into notes as the only store.
  for (const i of reviewed.instructions) parts.push(i);
  if (reviewed.notes) parts.push(reviewed.notes);
  const out = parts.map((p) => p.trim()).filter(Boolean).join("\n");
  return out || null;
}

function mapReviewedItems(reviewed: ControllerReviewedDraft, jobType: JobType) {
  return mapReviewedItemsForParse(reviewed, jobType);
}

/**
 * Convert a human-reviewed import draft into canonical Create Job input.
 * Import owns only this conversion (prefill → form fields). TransportJobsService.createCanonicalJob
 * owns validation, status, refs, JobItems, Trips, and other creation invariants.
 * PIC maps onto both pickup contact and receiver because the review UI has a single PIC field;
 * that is form prefill, not an AI-specific Job creation rule.
 */
export function reviewedDraftToCreateJobDto(input: {
  reviewed: ControllerReviewedDraft;
  timezone: string;
}): CreateJobDto {
  const reviewed = input.reviewed;
  const jobType = movementTypeToJobType(reviewed.movementType);
  if (!jobType) {
    throw new Error("UNKNOWN_MOVEMENT_TYPE");
  }
  if (!reviewed.customerCompanyId) {
    throw new Error("MISSING_CUSTOMER");
  }

  const collectionType =
    jobType === JobType.COLLECTION
      ? resolveCollectionTypeForJobCreate(jobType, reviewed.collectionType)
      : null;

  const mappedItems = mapReviewedItems(reviewed, jobType);
  const validItems = ensureCollectionJobItems(
    jobType,
    parseValidJobItemsFromInput(mappedItems, jobType),
  );
  assertCreateJobItemsRequiredForJobType(jobType, mappedItems, validItems);

  const returnDestination =
    jobType === JobType.RETURN
      ? resolveReturnDestinationFields({
          returningDepotCode: reviewed.returningDepotCode,
          returningDepotAddress1: reviewed.returningDepotAddress1,
          returningDepotAddress2: reviewed.returningDepotAddress2,
          returningDepotPostal: reviewed.returningDepotPostal,
          returningDepotPlaceId: reviewed.returningDepotPlaceId,
          returningDepotLat: reviewed.returningDepotLat,
          returningDepotLng: reviewed.returningDepotLng,
          deliveryAddress1: reviewed.deliveryAddress1,
          deliveryAddress2: reviewed.deliveryAddress2,
          deliveryPostal: reviewed.deliveryPostal,
          deliveryPlaceId: reviewed.deliveryPlaceId,
          deliveryLat: reviewed.deliveryLat,
          deliveryLng: reviewed.deliveryLng,
        })
      : null;
  if (jobType === JobType.RETURN && !returnDestination) {
    throw new Error("MISSING_LOCATION");
  }

  const deliveryAddress1 =
    returnDestination?.deliveryAddress1 ?? reviewed.deliveryAddress1;
  const deliveryAddress2 =
    returnDestination?.deliveryAddress2 ?? reviewed.deliveryAddress2;
  const deliveryPostal =
    returnDestination?.deliveryPostal ?? reviewed.deliveryPostal;
  const deliveryPlaceId =
    returnDestination?.deliveryPlaceId ?? reviewed.deliveryPlaceId;
  const deliveryLat = returnDestination?.deliveryLat ?? reviewed.deliveryLat;
  const deliveryLng = returnDestination?.deliveryLng ?? reviewed.deliveryLng;
  const returningDepotAddress1 =
    returnDestination?.returningDepotAddress1 ?? reviewed.returningDepotAddress1;
  const returningDepotAddress2 =
    returnDestination?.returningDepotAddress2 ?? reviewed.returningDepotAddress2;
  const returningDepotPostal =
    returnDestination?.returningDepotPostal ?? reviewed.returningDepotPostal;
  const returningDepotPlaceId =
    returnDestination?.returningDepotPlaceId ?? reviewed.returningDepotPlaceId;
  const returningDepotLat =
    returnDestination?.returningDepotLat ?? reviewed.returningDepotLat;
  const returningDepotLng =
    returnDestination?.returningDepotLng ?? reviewed.returningDepotLng;
  const returningDepotCode =
    returnDestination?.returningDepotCode ?? reviewed.returningDepotCode;

  const routeLocations = resolveCanonicalRouteLocations({
    jobType,
    pickupAddress1: reviewed.pickupAddress1,
    pickupAddress2: reviewed.pickupAddress2,
    pickupPostal: reviewed.pickupPostal,
    pickupPlaceId: reviewed.pickupPlaceId,
    pickupLat: reviewed.pickupLat,
    pickupLng: reviewed.pickupLng,
    pickupContactName: reviewed.picName,
    pickupContactPhone: reviewed.picPhone,
    deliveryAddress1,
    deliveryAddress2,
    deliveryPostal,
    deliveryPlaceId,
    deliveryLat,
    deliveryLng,
    receiverName: reviewed.picName,
    receiverPhone: reviewed.picPhone,
    exportDetails:
      jobType === JobType.EXPORT
        ? {
            stuffingAddress1: reviewed.deliveryAddress1,
            stuffingContactName: reviewed.picName,
            stuffingContactPhone: reviewed.picPhone,
            exportPortAddress1: reviewed.portAddress1,
            exportPortAddress2: reviewed.portAddress2,
            exportPortPostal: reviewed.portPostal,
            exportPortPlaceId: reviewed.portPlaceId,
            exportPortLat: reviewed.portLat,
            exportPortLng: reviewed.portLng,
          }
        : null,
    importDetails:
      jobType === JobType.IMPORT || jobType === JobType.RETURN
        ? {
            returningDepotAddress1,
            returningDepotAddress2,
            returningDepotPostal,
            returningDepotPlaceId,
            returningDepotLat,
            returningDepotLng,
            returningDepotCode,
          }
        : null,
  });
  try {
    assertCanonicalRouteLocationsForCreate(jobType, routeLocations);
  } catch {
    throw new Error("MISSING_LOCATION");
  }

  const pickupDate = reviewed.pickupDateLocal
    ? zonedLocalDateTimeToUtc(reviewed.pickupDateLocal, input.timezone)
    : null;
  const pickupDateHasTime = reviewed.pickupDateLocal
    ? requestedLocalHasTime(reviewed.pickupDateLocal)
    : null;
  const deliveryDate = reviewed.deliveryDateLocal
    ? zonedLocalDateTimeToUtc(reviewed.deliveryDateLocal, input.timezone)
    : null;
  const deliveryDateHasTime = reviewed.deliveryDateLocal
    ? requestedLocalHasTime(reviewed.deliveryDateLocal)
    : null;
  const firstContainer = validItems[0]?.itemCode ?? null;
  const seedContainer =
    jobType === JobType.IMPORT || jobType === JobType.EXPORT ? firstContainer : null;

  return {
    jobType,
    collectionType: collectionType ?? undefined,
    customerCompanyId: reviewed.customerCompanyId,
    pickupDate: pickupDate ? pickupDate.toISOString() : undefined,
    pickupDateHasTime: pickupDateHasTime === null ? undefined : pickupDateHasTime,
    deliveryDate: deliveryDate ? deliveryDate.toISOString() : undefined,
    deliveryDateHasTime: deliveryDateHasTime === null ? undefined : deliveryDateHasTime,
    pickupAddress1: reviewed.pickupAddress1,
    pickupAddress2: reviewed.pickupAddress2 ?? undefined,
    pickupPostal: reviewed.pickupPostal ?? undefined,
    pickupPlaceId: reviewed.pickupPlaceId ?? undefined,
    pickupLat: reviewed.pickupLat ?? undefined,
    pickupLng: reviewed.pickupLng ?? undefined,
    deliveryAddress1: deliveryAddress1!,
    deliveryAddress2: deliveryAddress2 ?? undefined,
    deliveryPostal: deliveryPostal ?? undefined,
    deliveryPlaceId: deliveryPlaceId ?? undefined,
    deliveryLat: deliveryLat ?? undefined,
    deliveryLng: deliveryLng ?? undefined,
    pickupContactName: reviewed.picName ?? undefined,
    pickupContactPhone: reviewed.picPhone ?? undefined,
    receiverName: reviewed.picName ?? "",
    receiverPhone: reviewed.picPhone ?? "",
    pickupReference:
      trimToNull(reviewed.pickupReference) ??
      collectionPickupReferenceFromReviewed(reviewed) ??
      undefined,
    description: reviewed.timingText ?? undefined,
    notes: composeNotes(reviewed) ?? undefined,
    autoTripDocumentRequirements: reviewed.autoTripDocumentRequirements,
    carrierName: reviewed.carrierName ?? undefined,
    shipper: reviewed.shipper ?? undefined,
    vesselName: reviewed.vesselName ?? undefined,
    voyage: reviewed.voyage ?? undefined,
    containerNumber: seedContainer ?? undefined,
    items: validItems.map((it) => ({
      itemCode: it.itemCode,
      description: it.description ?? undefined,
      sealNo: it.sealNo ?? undefined,
      containerSize: it.containerSize ?? undefined,
      pickupReference: it.pickupReference ?? undefined,
      qty: it.qty ?? undefined,
    })),
    importDetails:
      jobType === JobType.IMPORT || jobType === JobType.RETURN
        ? {
            returningDepotAddress1,
            returningDepotAddress2,
            returningDepotPostal,
            returningDepotPlaceId,
            returningDepotLat,
            returningDepotLng,
            returningDepotCode,
          }
        : undefined,
    exportDetails:
      jobType === JobType.EXPORT
        ? {
            stuffingAddress1: reviewed.deliveryAddress1,
            stuffingAddress2: reviewed.deliveryAddress2,
            stuffingPostal: reviewed.deliveryPostal,
            stuffingContactName: reviewed.picName,
            stuffingContactPhone: reviewed.picPhone,
            containerPickupAddress1: reviewed.pickupAddress1,
            containerPickupAddress2: reviewed.pickupAddress2,
            containerPickupPostal: reviewed.pickupPostal,
            exportPortAddress1: reviewed.portAddress1,
            exportPortAddress2: reviewed.portAddress2,
            exportPortPostal: reviewed.portPostal,
            exportPortPlaceId: reviewed.portPlaceId,
            exportPortLat: reviewed.portLat,
            exportPortLng: reviewed.portLng,
          }
        : undefined,
  };
}

/**
 * @deprecated Prefer reviewedDraftToCreateJobDto + TransportJobsService.create.
 * Kept for mapping unit tests that inspect the projected Job fields.
 */
export function reviewedDraftToCanonicalJobCreate(input: {
  reviewed: ControllerReviewedDraft;
  timezone: string;
}): CanonicalJobCreateData {
  const dto = reviewedDraftToCreateJobDto(input);
  const validItems = parseValidJobItemsFromInput(dto.items ?? [], dto.jobType);
  return {
    jobType: dto.jobType,
    collectionType:
      dto.jobType === JobType.COLLECTION
        ? resolveCollectionTypeForJobCreate(dto.jobType, dto.collectionType)
        : null,
    customerCompanyId: dto.customerCompanyId,
    pickupDate: dto.pickupDate ? new Date(dto.pickupDate) : null,
    pickupDateHasTime:
      dto.pickupDateHasTime === undefined ? null : dto.pickupDateHasTime ?? null,
    deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
    deliveryDateHasTime:
      dto.deliveryDateHasTime === undefined ? null : dto.deliveryDateHasTime ?? null,
    pickupAddress1: dto.pickupAddress1,
    pickupAddress2: dto.pickupAddress2 ?? null,
    pickupPostal: dto.pickupPostal ?? null,
    deliveryAddress1: dto.deliveryAddress1,
    deliveryAddress2: dto.deliveryAddress2 ?? null,
    deliveryPostal: dto.deliveryPostal ?? null,
    pickupContactName: dto.pickupContactName ?? null,
    pickupContactPhone: dto.pickupContactPhone ?? null,
    receiverName: dto.receiverName ?? "",
    receiverPhone: dto.receiverPhone ?? "",
    description: dto.description ?? null,
    notes: dto.notes ?? null,
    carrierName: dto.carrierName ?? null,
    shipper: dto.shipper ?? null,
    vesselName: dto.vesselName ?? null,
    voyage: dto.voyage ?? null,
    status: JobStatus.ONGOING,
    items: validItems,
  };
}
