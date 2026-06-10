import { resolveTripDetailsNotificationKind } from "./trip-details-notification";

describe("resolveTripDetailsNotificationKind", () => {
  it("returns TRIP_NOTES_UPDATED when only trip notes changed", () => {
    expect(resolveTripDetailsNotificationKind(["notes"])).toBe(
      "TRIP_NOTES_UPDATED",
    );
  });

  it("returns TRIP_INSTRUCTIONS_UPDATED when only job notes changed", () => {
    expect(resolveTripDetailsNotificationKind(["jobNotes"])).toBe(
      "TRIP_INSTRUCTIONS_UPDATED",
    );
  });
});
