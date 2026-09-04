import {
  formatRequestedTimingDisplay,
  requestedLocalFromPersisted,
  serializeRequestedDeliveryForJob,
  serializeRequestedPickupForJob,
  serializeRequestedTimingForJob,
  zonedRequestedLocalToUtc,
} from "./requested-timing";

describe("requested-timing", () => {
  const TZ = "Asia/Singapore";

  it("formats date-only without inventing a clock time", () => {
    expect(formatRequestedTimingDisplay("2026-09-04")).toBe(
      "4 Sep 2026 · Time not specified",
    );
  });

  it("preserves an explicit 08:30 through timezone-safe round-trip", () => {
    const local = "2026-09-04T08:30";
    const utc = zonedRequestedLocalToUtc(local, TZ);
    const back = requestedLocalFromPersisted({
      at: utc,
      hasTime: true,
      timeZone: TZ,
    });
    expect(back).toBe(local);
    expect(formatRequestedTimingDisplay(local)).toBe("4 Sep 2026, 8:30 AM");
  });

  it("serializes date-only with hasTime=false using local midnight as calendar anchor only", () => {
    const serialized = serializeRequestedTimingForJob("2026-09-04", TZ);
    expect(serialized.hasTime).toBe(false);
    expect(serialized.at).toBe(
      zonedRequestedLocalToUtc("2026-09-04T00:00", TZ).toISOString(),
    );
    expect(
      requestedLocalFromPersisted({
        at: serialized.at,
        hasTime: false,
        timeZone: TZ,
      }),
    ).toBe("2026-09-04");
    expect(serializeRequestedPickupForJob("2026-09-04", TZ).pickupDateHasTime).toBe(false);
    expect(serializeRequestedDeliveryForJob("2026-09-04", TZ).deliveryDateHasTime).toBe(false);
  });

  it("leaves unset timing null", () => {
    expect(serializeRequestedTimingForJob(null, TZ)).toEqual({
      at: null,
      hasTime: null,
    });
  });

  it("does not reinterpret legacy midnight as date-only when hasTime is null", () => {
    const midnight = zonedRequestedLocalToUtc("2026-09-04T00:00", TZ);
    expect(
      requestedLocalFromPersisted({
        at: midnight,
        hasTime: null,
        timeZone: TZ,
      }),
    ).toBe("2026-09-04T00:00");
  });
});
