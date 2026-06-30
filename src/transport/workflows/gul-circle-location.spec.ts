import { GUL_CIRCLE_LOCATION, isLegacyGulCircleCoords, LEGACY_GUL_CIRCLE_COORDS } from "./gul-circle-location";

describe("gul-circle-location", () => {
  it("uses corrected 7 Gul Circle coordinates (not legacy water-offset coords)", () => {
    expect(GUL_CIRCLE_LOCATION.lat).toBeCloseTo(1.3107274, 6);
    expect(GUL_CIRCLE_LOCATION.lng).toBeCloseTo(103.6749418, 6);
    expect(GUL_CIRCLE_LOCATION.lat).not.toBe(LEGACY_GUL_CIRCLE_COORDS.lat);
    expect(GUL_CIRCLE_LOCATION.lng).not.toBe(LEGACY_GUL_CIRCLE_COORDS.lng);
  });

  it("detects legacy Gul Circle coordinates for repair", () => {
    expect(isLegacyGulCircleCoords(1.30995, 103.65573)).toBe(true);
    expect(isLegacyGulCircleCoords(GUL_CIRCLE_LOCATION.lat, GUL_CIRCLE_LOCATION.lng)).toBe(false);
  });
});
