import type { ControllerReviewedDraft } from "./job-message-import.types";
import { enrichAddressFields } from "./job-message-import.address-parse";
import {
  addressContainsTimingExpression,
  splitLocationFromTiming,
} from "./job-message-import.labelled-fields";
import { normalizeLocationLabel } from "./job-message-import.text-normalize";
import { parseOperationalTiming } from "./job-message-import.timing";
import { trimToNull } from "./job-message-import.validator";

/**
 * Re-split location/timing when a stored draft still embeds timing in address fields.
 * Used when serving existing preview batches created before extraction fixes.
 */
export function repairReviewedDraftTiming(
  reviewed: ControllerReviewedDraft,
  context: { timezone: string; referenceDate: string },
): ControllerReviewedDraft {
  let next = { ...reviewed };
  let changed = false;

  if (addressContainsTimingExpression(next.pickupAddress1)) {
    const split = splitLocationFromTiming(next.pickupAddress1);
    if (split.location && split.timingText) {
      next.pickupAddress1 = normalizeLocationLabel(split.location);
      next.timingText = next.timingText ?? split.timingText;
      const timing = parseOperationalTiming({
        text: split.timingText,
        referenceDate: context.referenceDate,
        timezone: context.timezone,
      });
      next.pickupDateLocal = timing.pickupDateLocal;
      next.pickupDateDisplay = timing.display;
      next.pickupDateNeedsReview = timing.needsReview;
      changed = true;
    }
  }

  if (addressContainsTimingExpression(next.deliveryAddress1)) {
    const split = splitLocationFromTiming(next.deliveryAddress1);
    if (split.location && split.timingText) {
      next.deliveryAddress1 = normalizeLocationLabel(split.location);
      next.timingText = next.timingText ?? split.timingText;
      const timing = parseOperationalTiming({
        text: split.timingText,
        referenceDate: context.referenceDate,
        timezone: context.timezone,
      });
      next.deliveryDateLocal = timing.pickupDateLocal;
      next.deliveryDateDisplay = timing.display;
      next.deliveryDateNeedsReview = timing.needsReview;
      changed = true;
    }
  }

  if (!changed) return reviewed;
  return next;
}

export function enrichReviewedAddressFields(
  reviewed: ControllerReviewedDraft,
): ControllerReviewedDraft {
  const pickup = enrichAddressFields({
    address1: reviewed.pickupAddress1,
    address2: reviewed.pickupAddress2,
    postal: reviewed.pickupPostal,
  });
  const delivery = enrichAddressFields({
    address1: reviewed.deliveryAddress1,
    address2: reviewed.deliveryAddress2,
    postal: reviewed.deliveryPostal,
  });

  const pickupAddress1 = normalizeLocationLabel(pickup.address1);
  const deliveryAddress1 = normalizeLocationLabel(delivery.address1);

  if (
    pickupAddress1 === reviewed.pickupAddress1 &&
    pickup.postal === reviewed.pickupPostal &&
    pickup.address2 === reviewed.pickupAddress2 &&
    deliveryAddress1 === reviewed.deliveryAddress1 &&
    delivery.postal === reviewed.deliveryPostal &&
    delivery.address2 === reviewed.deliveryAddress2
  ) {
    return reviewed;
  }

  return {
    ...reviewed,
    pickupAddress1,
    pickupAddress2: trimToNull(pickup.address2),
    pickupPostal: trimToNull(pickup.postal),
    deliveryAddress1,
    deliveryAddress2: trimToNull(delivery.address2),
    deliveryPostal: trimToNull(delivery.postal),
  };
}

export function sanitizeReviewedDraftForResponse(
  reviewed: ControllerReviewedDraft,
  context: { timezone: string; referenceDate: string },
): ControllerReviewedDraft {
  return enrichReviewedAddressFields(
    repairReviewedDraftTiming(reviewed, context),
  );
}
