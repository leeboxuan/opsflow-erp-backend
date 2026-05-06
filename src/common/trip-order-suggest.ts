type Coordinate = { lat: number; lng: number };

export type SuggestOrderTripInput = {
  id: string;
  originLat?: number | null;
  originLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
};

export type SuggestTripOrderInput = {
  trips: SuggestOrderTripInput[];
  startLocation?: Coordinate | null;
};

export type SuggestTripOrderOutput = {
  suggestedTripIdsInOrder: string[];
  warnings: string[];
};

function distance(a: Coordinate, b: Coordinate): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
}

export function suggestTripOrderByNearestNeighbour(
  input: SuggestTripOrderInput,
): SuggestTripOrderOutput {
  const warnings: string[] = [];
  const available = [...input.trips];
  const output: string[] = [];
  let current = input.startLocation
    ? { lat: input.startLocation.lat, lng: input.startLocation.lng }
    : null;

  while (available.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < available.length; i += 1) {
      const trip = available[i];
      if (
        current
        && trip.originLat != null
        && trip.originLng != null
      ) {
        const d = distance(current, { lat: trip.originLat, lng: trip.originLng });
        if (d < bestDistance) {
          bestDistance = d;
          bestIndex = i;
        }
      } else if (!current) {
        bestIndex = 0;
        break;
      }
    }

    const [nextTrip] = available.splice(bestIndex, 1);
    output.push(nextTrip.id);
    if (nextTrip.destinationLat != null && nextTrip.destinationLng != null) {
      current = { lat: nextTrip.destinationLat, lng: nextTrip.destinationLng };
    } else {
      warnings.push(`Trip ${nextTrip.id} missing destination coordinates`);
    }
    if (nextTrip.originLat == null || nextTrip.originLng == null) {
      warnings.push(`Trip ${nextTrip.id} missing origin coordinates`);
    }
  }

  return {
    suggestedTripIdsInOrder: output,
    warnings,
  };
}
