import { JobType } from "@prisma/client";
import type { ControllerReviewedDraft } from "./job-message-import.types";

/** Convert reviewed import items into Create Job item rows. Collection never copies pickup refs into identity. */
export function mapReviewedItemsForParse(
  reviewed: Pick<ControllerReviewedDraft, "items" | "containerSizeType">,
  jobType: JobType,
): Array<Record<string, unknown>> {
  return reviewed.items.map((it) => {
    if (jobType === JobType.LCL) {
      return {
        itemCode: it.referenceNumber || it.containerNumber,
        qty: it.quantity ?? 1,
        sealNo: it.sealNumber,
      };
    }
    if (jobType === JobType.COLLECTION) {
      return {
        containerNumber: it.containerNumber,
        sealNo: it.sealNumber,
        qty: it.quantity ?? 1,
        containerSize: reviewed.containerSizeType,
      };
    }
    return {
      containerNumber: it.containerNumber || it.referenceNumber,
      sealNo: it.sealNumber,
      qty: it.quantity,
      containerSize: reviewed.containerSizeType,
    };
  });
}

export function collectionPickupReferenceFromReviewed(
  reviewed: Pick<ControllerReviewedDraft, "items">,
): string | null {
  for (const it of reviewed.items) {
    const ref = String(it.referenceNumber ?? "").trim();
    if (ref) return ref;
  }
  return null;
}
