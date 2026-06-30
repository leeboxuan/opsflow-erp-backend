/**
 * Canonical 7 Gul Circle depot location (Singapore 629563).
 * Geocoded from OpenStreetMap Nominatim (Keppel Gul Circle Districenter, 7 Gul Circle).
 * Replaces legacy master coords (1.30995, 103.65573) that plotted near water.
 */
export const GUL_CIRCLE_LOCATION = {
  label: "7 Gul Circle",
  addressLine1: "7 Gul Circle",
  postalCode: "629563",
  country: "SG",
  lat: 1.3107274,
  lng: 103.6749418,
  placeId: null as string | null,
} as const;

/** Legacy incorrect depot coordinates — used to repair stored trips. */
export const LEGACY_GUL_CIRCLE_COORDS = {
  lat: 1.30995,
  lng: 103.65573,
} as const;

export function isLegacyGulCircleCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  return (
    Math.abs(lat - LEGACY_GUL_CIRCLE_COORDS.lat) < 0.00001
    && Math.abs(lng - LEGACY_GUL_CIRCLE_COORDS.lng) < 0.00001
  );
}
