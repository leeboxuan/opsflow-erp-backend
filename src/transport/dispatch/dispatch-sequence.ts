import { TripStatus } from "@prisma/client";

export const DISPATCH_PLAN_CONFLICT_CODE = "DISPATCH_PLAN_CONFLICT";

export const PLANNING_EXCLUDED: TripStatus[] = [
  TripStatus.CANCELLED,
  TripStatus.COMPLETED,
  TripStatus.DONE,
];

export const SEQUENCE_LOCKED: TripStatus[] = [TripStatus.ONGOING];

export function isDispatchSequenceLocked(status: TripStatus | string): boolean {
  return SEQUENCE_LOCKED.includes(status as TripStatus);
}

export type DispatchOrderTrip = {
  id: string;
  status: TripStatus | string;
  dispatchSequence?: number | null;
  tripSequence?: number | null;
  jobSequence?: number | null;
};

export function compareDispatchSequence(
  a: { id: string; dispatchSequence?: number | null },
  b: { id: string; dispatchSequence?: number | null },
): number {
  const aSeq = a.dispatchSequence == null ? 9999 : a.dispatchSequence;
  const bSeq = b.dispatchSequence == null ? 9999 : b.dispatchSequence;
  if (aSeq !== bSeq) return aSeq - bSeq;
  return a.id.localeCompare(b.id);
}

/** Sort by dispatchSequence (driver-day), never by job-local tripSequence. */
export function sortByDispatchSequence<T extends { id: string; dispatchSequence?: number | null }>(
  trips: readonly T[],
): T[] {
  return [...trips].sort(compareDispatchSequence);
}

/**
 * ONGOING trips must keep their absolute 0-based index in the saved dispatch order.
 * Relative-only checks are insufficient.
 */
export function assertLockedAbsoluteDispatchPositions(input: {
  currentOrderedIds: readonly string[];
  requestedIds: readonly string[];
  lockedIds: ReadonlySet<string>;
}): { ok: true } | { ok: false; message: string; tripId: string; position: number } {
  const { currentOrderedIds, requestedIds, lockedIds } = input;
  for (let i = 0; i < currentOrderedIds.length; i += 1) {
    const id = currentOrderedIds[i]!;
    if (!lockedIds.has(id)) continue;
    if (requestedIds[i] !== id) {
      return {
        ok: false,
        tripId: id,
        position: i + 1,
        message: `Locked trip ${id} must remain at dispatch position ${i + 1}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Pure merge used by suggestion: keep locked trips at absolute indexes from
 * the current ordered list; fill remaining slots with suggested unlocked ids.
 */
export function mergeSuggestedWithLockedAbsolutePositions(input: {
  currentOrderedIds: readonly string[];
  suggestedUnlockedIds: readonly string[];
  lockedIds: ReadonlySet<string>;
}): string[] {
  const unlockedQueue = [...input.suggestedUnlockedIds];
  const out: string[] = [];
  for (const id of input.currentOrderedIds) {
    if (input.lockedIds.has(id)) {
      out.push(id);
    } else {
      const next = unlockedQueue.shift();
      if (next) out.push(next);
    }
  }
  // Append any leftover unlocked (should not happen when sets match).
  for (const id of unlockedQueue) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
