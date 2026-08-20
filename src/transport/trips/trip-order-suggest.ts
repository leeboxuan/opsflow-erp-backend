type Coordinate = { lat: number; lng: number };

export type SuggestOrderTripInput = {
  id: string;
  originLat?: number | null;
  originLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  /** When true, keep relative position and do not reorder this trip. */
  locked?: boolean;
  status?: string | null;
};

export type SuggestTripOrderInput = {
  trips: SuggestOrderTripInput[];
  startLocation?: Coordinate | null;
};

export type SuggestExclusion = {
  tripId: string;
  reason: string;
};

export type SuggestTripOrderOutput = {
  /** Stable label for UI — never claim traffic-aware optimization. */
  algorithm: "NEAREST_NEIGHBOUR";
  label: "Suggested sequence";
  suggestedTripIdsInOrder: string[];
  includedTripIds: string[];
  excluded: SuggestExclusion[];
  warnings: string[];
  /** Approximate planar distance units between chained points (not road meters). */
  approximatePlanarDistance: number | null;
};

function distance(a: Coordinate, b: Coordinate): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
}

function hasValidOrigin(trip: SuggestOrderTripInput): boolean {
  return (
    typeof trip.originLat === "number" &&
    Number.isFinite(trip.originLat) &&
    typeof trip.originLng === "number" &&
    Number.isFinite(trip.originLng)
  );
}

function hasValidDestination(trip: SuggestOrderTripInput): boolean {
  return (
    typeof trip.destinationLat === "number" &&
    Number.isFinite(trip.destinationLat) &&
    typeof trip.destinationLng === "number" &&
    Number.isFinite(trip.destinationLng)
  );
}

/**
 * Deterministic nearest-neighbour chaining using planar lat/lng deltas.
 * Locked trips keep their relative slots; unlocked trips are reordered among gaps.
 * Advisory only — callers must not auto-publish.
 */
export function suggestTripOrderByNearestNeighbour(
  input: SuggestTripOrderInput,
): SuggestTripOrderOutput {
  const warnings: string[] = [];
  const excluded: SuggestExclusion[] = [];
  const trips = [...input.trips];

  for (const trip of trips) {
    if (!hasValidOrigin(trip)) {
      warnings.push(`Trip ${trip.id} missing origin coordinates`);
      excluded.push({
        tripId: trip.id,
        reason: "MISSING_ORIGIN_COORDINATES",
      });
    }
    if (!hasValidDestination(trip)) {
      warnings.push(`Trip ${trip.id} missing destination coordinates`);
      if (!excluded.some((e) => e.tripId === trip.id)) {
        excluded.push({
          tripId: trip.id,
          reason: "MISSING_DESTINATION_COORDINATES",
        });
      }
    }
  }

  const lockedIndexes = new Map<number, string>();
  const unlocked: SuggestOrderTripInput[] = [];
  trips.forEach((trip, index) => {
    if (trip.locked) {
      lockedIndexes.set(index, trip.id);
    } else {
      unlocked.push(trip);
    }
  });

  const orderedUnlocked: string[] = [];
  const pool = [...unlocked];
  let current = input.startLocation
    ? { lat: input.startLocation.lat, lng: input.startLocation.lng }
    : null;
  let planar = 0;
  let planarUsed = false;

  while (pool.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let foundWithCoords = false;

    for (let i = 0; i < pool.length; i += 1) {
      const trip = pool[i]!;
      if (current && hasValidOrigin(trip)) {
        const d = distance(current, {
          lat: trip.originLat!,
          lng: trip.originLng!,
        });
        if (d < bestDistance) {
          bestDistance = d;
          bestIndex = i;
          foundWithCoords = true;
        }
      }
    }

    if (!current || !foundWithCoords) {
      bestIndex = 0;
    } else {
      planar += bestDistance;
      planarUsed = true;
    }

    const [nextTrip] = pool.splice(bestIndex, 1);
    orderedUnlocked.push(nextTrip!.id);
    if (hasValidDestination(nextTrip!)) {
      current = {
        lat: nextTrip!.destinationLat!,
        lng: nextTrip!.destinationLng!,
      };
    }
  }

  // Merge locked slots with unlocked sequence.
  const suggestedTripIdsInOrder: string[] = [];
  let unlockedCursor = 0;
  for (let i = 0; i < trips.length; i += 1) {
    const lockedId = lockedIndexes.get(i);
    if (lockedId) {
      suggestedTripIdsInOrder.push(lockedId);
    } else {
      suggestedTripIdsInOrder.push(orderedUnlocked[unlockedCursor++]!);
    }
  }

  return {
    algorithm: "NEAREST_NEIGHBOUR",
    label: "Suggested sequence",
    suggestedTripIdsInOrder,
    includedTripIds: suggestedTripIdsInOrder,
    excluded,
    warnings,
    approximatePlanarDistance: planarUsed ? planar : null,
  };
}
