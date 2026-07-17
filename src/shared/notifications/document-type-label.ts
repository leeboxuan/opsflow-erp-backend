import { TripDocumentType } from "@prisma/client";

const TRIP_DOCUMENT_LABELS: Partial<Record<TripDocumentType, string>> = {
  [TripDocumentType.PICKUP_DO]: "Pickup DO",
  [TripDocumentType.DELIVERY_DO]: "Delivery DO",
  [TripDocumentType.POD_PHOTO]: "POD photo",
  [TripDocumentType.POD_SIGNATURE]: "POD signature",
  [TripDocumentType.CONTAINER_PHOTO]: "Container photo",
  [TripDocumentType.SEAL_PHOTO]: "Seal photo",
  [TripDocumentType.TRAILER_START_PHOTO]: "Trailer start photo",
  [TripDocumentType.TRAILER_END_PHOTO]: "Trailer end photo",
  [TripDocumentType.OTHER]: "Document",
};

export function tripDocumentTypeLabel(
  type?: string | TripDocumentType | null,
): string {
  if (!type) return "document";
  return TRIP_DOCUMENT_LABELS[type as TripDocumentType] ?? "document";
}
