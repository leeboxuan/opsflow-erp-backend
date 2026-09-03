import { BadRequestException } from "@nestjs/common";
import { JobTripTemplate, JobType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { hasAutocompleteLocation } from "./create-job-validation.helpers";

export type CanonicalRouteLocation = {
  address1?: string | null;
  address2?: string | null;
  postal?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  code?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
};

export type CanonicalRouteLocations = {
  depot?: CanonicalRouteLocation | null;
  customer?: CanonicalRouteLocation | null;
  port?: CanonicalRouteLocation | null;
  returnDepot?: CanonicalRouteLocation | null;
  pickup?: CanonicalRouteLocation | null;
  delivery?: CanonicalRouteLocation | null;
};

export type CanonicalRouteLocationInput = {
  jobType: JobType;
  pickupAddress1?: string | null;
  pickupAddress2?: string | null;
  pickupPostal?: string | null;
  pickupPlaceId?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupContactName?: string | null;
  pickupContactPhone?: string | null;
  pickupPortCode?: string | null;
  deliveryAddress1?: string | null;
  deliveryAddress2?: string | null;
  deliveryPostal?: string | null;
  deliveryPlaceId?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  exportDetails?: {
    containerPickupAddress1?: string | null;
    containerPickupAddress2?: string | null;
    containerPickupPostal?: string | null;
    stuffingAddress1?: string | null;
    stuffingAddress2?: string | null;
    stuffingPostal?: string | null;
    stuffingContactName?: string | null;
    stuffingContactPhone?: string | null;
    pickupDepotCode?: string | null;
    exportOriginDepotCode?: string | null;
    exportPortCode?: string | null;
    exportPortAddress1?: string | null;
    exportPortAddress2?: string | null;
    exportPortPostal?: string | null;
    exportPortPlaceId?: string | null;
    exportPortLat?: number | null;
    exportPortLng?: number | null;
  } | null;
  importDetails?: {
    pickupPortCode?: string | null;
    returningDepotCode?: string | null;
    returningDepotAddress1?: string | null;
    returningDepotAddress2?: string | null;
    returningDepotPostal?: string | null;
    returningDepotPlaceId?: string | null;
    returningDepotLat?: number | null;
    returningDepotLng?: number | null;
  } | null;
  returningDepotCode?: string | null;
  exportPortCode?: string | null;
  exportOriginDepotCode?: string | null;
};

function loc(
  input: CanonicalRouteLocation,
): CanonicalRouteLocation {
  return {
    address1: input.address1?.trim() || null,
    address2: input.address2?.trim() || null,
    postal: input.postal?.trim() || null,
    placeId: input.placeId?.trim() || null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    code: input.code?.trim() || null,
    contactName: input.contactName?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
  };
}

function locationIsPresent(input?: CanonicalRouteLocation | null): boolean {
  if (!input) return false;
  return (
    hasAutocompleteLocation({
      address1: input.address1,
      placeId: input.placeId,
    }) || Boolean(input.code?.trim())
  );
}

/**
 * Maps Create Job (and AI confirm) fields onto operational route roles.
 * Reuses Job pickup and delivery columns plus nested import/export details.
 * No extra Job table.
 *
 * EXPORT: customer from delivery/stuffing, port from exportDetails.
 *   Optional empty-depot fields on pickup/containerPickup remain commercial
 *   reference only and never seed auto-trips.
 * IMPORT: port from pickup, customer from delivery, returnDepot from returningDepot.
 * LCL/COLLECTION/ONE_WAY: pickup and delivery stay pickup/delivery.
 * RETURN: pickup from pickup fields; depot from returningDepot (searchable depot catalogue).
 */
export function resolveCanonicalRouteLocations(
  input: CanonicalRouteLocationInput,
): CanonicalRouteLocations {
  const exportDetails = input.exportDetails ?? {};
  const importDetails = input.importDetails ?? {};
  const customerContactName =
    exportDetails.stuffingContactName?.trim() ||
    input.receiverName?.trim() ||
    null;
  const customerContactPhone =
    exportDetails.stuffingContactPhone?.trim() ||
    input.receiverPhone?.trim() ||
    null;

  if (input.jobType === JobType.EXPORT) {
    return {
      // Optional compatibility/reference only — not part of create-time topology.
      depot: loc({
        address1:
          input.pickupAddress1 || exportDetails.containerPickupAddress1,
        address2:
          input.pickupAddress2 || exportDetails.containerPickupAddress2,
        postal: input.pickupPostal || exportDetails.containerPickupPostal,
        placeId: input.pickupPlaceId,
        lat: input.pickupLat,
        lng: input.pickupLng,
        code:
          exportDetails.exportOriginDepotCode ||
          exportDetails.pickupDepotCode ||
          input.exportOriginDepotCode,
      }),
      customer: loc({
        address1: exportDetails.stuffingAddress1 || input.deliveryAddress1,
        address2: exportDetails.stuffingAddress2 || input.deliveryAddress2,
        postal: exportDetails.stuffingPostal || input.deliveryPostal,
        placeId: input.deliveryPlaceId,
        lat: input.deliveryLat,
        lng: input.deliveryLng,
        contactName: customerContactName,
        contactPhone: customerContactPhone,
      }),
      port: loc({
        address1: exportDetails.exportPortAddress1,
        address2: exportDetails.exportPortAddress2,
        postal: exportDetails.exportPortPostal,
        placeId: exportDetails.exportPortPlaceId,
        lat: exportDetails.exportPortLat,
        lng: exportDetails.exportPortLng,
        code: exportDetails.exportPortCode || input.exportPortCode,
      }),
    };
  }

  if (input.jobType === JobType.IMPORT) {
    return {
      port: loc({
        address1: input.pickupAddress1,
        address2: input.pickupAddress2,
        postal: input.pickupPostal,
        placeId: input.pickupPlaceId,
        lat: input.pickupLat,
        lng: input.pickupLng,
        code: importDetails.pickupPortCode || input.pickupPortCode,
      }),
      customer: loc({
        address1: input.deliveryAddress1,
        address2: input.deliveryAddress2,
        postal: input.deliveryPostal,
        placeId: input.deliveryPlaceId,
        lat: input.deliveryLat,
        lng: input.deliveryLng,
        contactName: input.receiverName,
        contactPhone: input.receiverPhone,
      }),
      returnDepot: loc({
        address1: importDetails.returningDepotAddress1,
        address2: importDetails.returningDepotAddress2,
        postal: importDetails.returningDepotPostal,
        placeId: importDetails.returningDepotPlaceId,
        lat: importDetails.returningDepotLat,
        lng: importDetails.returningDepotLng,
        code:
          importDetails.returningDepotCode || input.returningDepotCode,
      }),
    };
  }

  if (input.jobType === JobType.RETURN) {
    return {
      pickup: loc({
        address1: input.pickupAddress1,
        address2: input.pickupAddress2,
        postal: input.pickupPostal,
        placeId: input.pickupPlaceId,
        lat: input.pickupLat,
        lng: input.pickupLng,
        contactName: input.pickupContactName,
        contactPhone: input.pickupContactPhone,
      }),
      returnDepot: loc({
        address1:
          importDetails.returningDepotAddress1 || input.deliveryAddress1,
        address2:
          importDetails.returningDepotAddress2 || input.deliveryAddress2,
        postal: importDetails.returningDepotPostal || input.deliveryPostal,
        placeId:
          importDetails.returningDepotPlaceId || input.deliveryPlaceId,
        lat: importDetails.returningDepotLat ?? input.deliveryLat,
        lng: importDetails.returningDepotLng ?? input.deliveryLng,
        code: importDetails.returningDepotCode || input.returningDepotCode,
      }),
    };
  }

  return {
    pickup: loc({
      address1: input.pickupAddress1,
      address2: input.pickupAddress2,
      postal: input.pickupPostal,
      placeId: input.pickupPlaceId,
      lat: input.pickupLat,
      lng: input.pickupLng,
      contactName: input.pickupContactName,
      contactPhone: input.pickupContactPhone,
    }),
    delivery: loc({
      address1: input.deliveryAddress1,
      address2: input.deliveryAddress2,
      postal: input.deliveryPostal,
      placeId: input.deliveryPlaceId,
      lat: input.deliveryLat,
      lng: input.deliveryLng,
      contactName: input.receiverName,
      contactPhone: input.receiverPhone,
    }),
  };
}

export function assertCanonicalRouteLocationsForCreate(
  jobType: JobType,
  locations: CanonicalRouteLocations,
): void {
  if (jobType === JobType.EXPORT) {
    // Empty-container depot is optional commercial/reference only.
    if (!locationIsPresent(locations.customer)) {
      throw new BadRequestException(
        "Customer / stuffing location is required.",
      );
    }
    if (!locationIsPresent(locations.port)) {
      throw new BadRequestException("Export port / terminal is required.");
    }
    return;
  }
  if (jobType === JobType.IMPORT) {
    if (!locationIsPresent(locations.port)) {
      throw new BadRequestException("Import port / terminal is required.");
    }
    if (!locationIsPresent(locations.customer)) {
      throw new BadRequestException(
        "Customer / delivery location is required.",
      );
    }
    if (!locationIsPresent(locations.returnDepot)) {
      throw new BadRequestException(
        "Empty container return depot is required.",
      );
    }
    return;
  }
  if (jobType === JobType.RETURN) {
    if (!locationIsPresent(locations.pickup)) {
      throw new BadRequestException("Pickup location is required.");
    }
    if (!locationIsPresent(locations.returnDepot)) {
      throw new BadRequestException("Return depot is required.");
    }
    return;
  }
  if (!locationIsPresent(locations.pickup)) {
    throw new BadRequestException("Pickup location is required.");
  }
  if (!locationIsPresent(locations.delivery)) {
    throw new BadRequestException("Delivery location is required.");
  }
}

function originFields(
  location: CanonicalRouteLocation | null | undefined,
): Partial<Prisma.TripCreateManyInput> {
  const label = location?.address1?.trim() || null;
  return {
    originLabel: label,
    originAddressLine1: label,
    originAddressLine2: location?.address2?.trim() || null,
    originPostalCode: location?.postal?.trim() || null,
    originCountry: "SG",
    originLat: location?.lat ?? null,
    originLng: location?.lng ?? null,
    originPlaceId: location?.placeId?.trim() || null,
  };
}

function destinationFields(
  location: CanonicalRouteLocation | null | undefined,
): Partial<Prisma.TripCreateManyInput> {
  const label = location?.address1?.trim() || null;
  return {
    destinationLabel: label,
    destinationAddressLine1: label,
    destinationAddressLine2: location?.address2?.trim() || null,
    destinationPostalCode: location?.postal?.trim() || null,
    destinationCountry: "SG",
    destinationLat: location?.lat ?? null,
    destinationLng: location?.lng ?? null,
    destinationPlaceId: location?.placeId?.trim() || null,
  };
}

function tripPicFields(
  location: CanonicalRouteLocation | null | undefined,
): Pick<Prisma.TripCreateManyInput, "tripPICName" | "tripPICContact"> {
  return {
    tripPICName: location?.contactName?.trim() || null,
    tripPICContact: location?.contactPhone?.trim() || null,
  };
}

/**
 * Create-time Trip origin/destination snapshots from operational route roles.
 * EXPORT: Customer/Stuffing → Export Port (one Trip).
 * RETURN: Pickup → Depot (one Trip).
 * ONE_WAY / LCL / COLLECTION: Pickup → Delivery.
 * Historical DEPOT_TO_DELIVERY / PORT_TO_DEPOT rows remain display-only.
 */
export function canonicalAutoTripRouteSnapshots(
  jobType: JobType,
  locations: CanonicalRouteLocations,
): Partial<Record<JobTripTemplate, Partial<Prisma.TripCreateManyInput>>> {
  if (jobType === JobType.EXPORT) {
    return {
      [JobTripTemplate.DELIVERY_TO_PORT]: {
        ...originFields(locations.customer),
        ...destinationFields(locations.port),
        ...tripPicFields(locations.customer),
      },
    };
  }
  if (jobType === JobType.IMPORT) {
    return {
      [JobTripTemplate.PICKUP_TO_DELIVERY]: {
        ...originFields(locations.port),
        ...destinationFields(locations.customer),
        ...tripPicFields(locations.customer),
      },
      [JobTripTemplate.DELIVERY_TO_DEPOT]: {
        ...originFields(locations.customer),
        ...destinationFields(locations.returnDepot),
      },
    };
  }
  if (jobType === JobType.RETURN) {
    return {
      [JobTripTemplate.PICKUP_TO_DELIVERY]: {
        ...originFields(locations.pickup),
        ...destinationFields(locations.returnDepot),
        ...tripPicFields(locations.pickup),
      },
    };
  }
  return {
    [JobTripTemplate.PICKUP_TO_DELIVERY]: {
      ...originFields(locations.pickup),
      ...destinationFields(locations.delivery),
      ...tripPicFields(locations.delivery),
    },
  };
}
