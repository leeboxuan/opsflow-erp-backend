import { TripDocumentType } from "@prisma/client";

/** Trip document types returned on admin/web list and job detail endpoints. */
export const ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES: TripDocumentType[] = [
  TripDocumentType.PICKUP_DO,
  TripDocumentType.DELIVERY_DO,
  TripDocumentType.POD_PHOTO,
  TripDocumentType.POD_SIGNATURE,
  TripDocumentType.PICKUP_SIGNATURE,
  TripDocumentType.DELIVERY_SIGNATURE,
  TripDocumentType.OTHER,
  TripDocumentType.CONTAINER_PHOTO,
  TripDocumentType.SEAL_PHOTO,
  TripDocumentType.TRAILER_START_PHOTO,
  TripDocumentType.TRAILER_END_PHOTO,
  TripDocumentType.TRAILER_PARKING_PHOTO,
];

export type TripDocumentCardStatus = "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";

export type TripDocumentStatusDto = {
  pickupDo: TripDocumentCardStatus;
  deliveryDo: TripDocumentCardStatus;
  podSignature: TripDocumentCardStatus;
  receiverDo: TripDocumentCardStatus;
  podPhoto: TripDocumentCardStatus;
  trailerStartPhoto: TripDocumentCardStatus;
  trailerEndPhoto: TripDocumentCardStatus;
};

export function deriveTripDocumentStatus(
  documents: Array<{
    type?: string;
    generatedBySystem?: boolean | null;
    isSigned?: boolean | null;
  }> | null | undefined,
): TripDocumentStatusDto {
  const docs = documents ?? [];
  const find = (type: TripDocumentType) =>
    docs.find((d) => d?.type === type);

  const pickupDoDoc = find(TripDocumentType.PICKUP_DO);
  const deliveryDoDoc = find(TripDocumentType.DELIVERY_DO);
  const podPhotoDoc = find(TripDocumentType.POD_PHOTO);
  const trailerStartDoc = find(TripDocumentType.TRAILER_START_PHOTO);
  const trailerEndDoc = find(TripDocumentType.TRAILER_END_PHOTO);

  const hasPodSignature =
    !!find(TripDocumentType.POD_SIGNATURE)
    || !!find(TripDocumentType.DELIVERY_SIGNATURE);
  const hasReceiverDo = !!find(TripDocumentType.OTHER);

  let pickupDo: TripDocumentCardStatus = "PENDING";
  if (pickupDoDoc) {
    pickupDo = pickupDoDoc.isSigned ? "SIGNED" : "UPLOADED";
  }

  let deliveryDo: TripDocumentCardStatus = "GENERATED";
  if (deliveryDoDoc) {
    if (deliveryDoDoc.isSigned) {
      deliveryDo = "SIGNED";
    } else if (deliveryDoDoc.generatedBySystem) {
      deliveryDo = "GENERATED";
    } else {
      deliveryDo = "UPLOADED";
    }
  }

  return {
    pickupDo,
    deliveryDo,
    podSignature: hasPodSignature ? "UPLOADED" : "PENDING",
    receiverDo: hasReceiverDo ? "UPLOADED" : "PENDING",
    podPhoto: podPhotoDoc ? "UPLOADED" : "PENDING",
    trailerStartPhoto: trailerStartDoc ? "UPLOADED" : "PENDING",
    trailerEndPhoto: trailerEndDoc ? "UPLOADED" : "PENDING",
  };
}

export function groupTripDocumentsByTripId<T extends { tripId: string }>(
  documents: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const doc of documents) {
    const list = map.get(doc.tripId) ?? [];
    list.push(doc);
    map.set(doc.tripId, list);
  }
  return map;
}
