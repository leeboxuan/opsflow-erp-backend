import { BadRequestException } from "@nestjs/common";
import { resolveStatisticsDateRange } from "./statistics-date-range";

describe("resolveStatisticsDateRange", () => {
  it("converts Singapore calendar boundaries to inclusive-exclusive UTC", () => {
    const range = resolveStatisticsDateRange(
      { from: "2026-08-01", to: "2026-08-01" },
      "Asia/Singapore",
    );
    expect(range.gte.toISOString()).toBe("2026-07-31T16:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-08-01T16:00:00.000Z");
    expect(range.timeZone).toBe("Asia/Singapore");
  });

  it("preserves a daylight-saving boundary", () => {
    const range = resolveStatisticsDateRange(
      { from: "2024-03-10", to: "2024-03-10" },
      "America/New_York",
    );
    expect(range.gte.toISOString()).toBe("2024-03-10T05:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2024-03-11T04:00:00.000Z");
  });

  it("defaults to the last 30 tenant-local calendar days", () => {
    const range = resolveStatisticsDateRange(
      {},
      "Asia/Singapore",
      new Date("2026-08-05T12:00:00.000Z"),
    );
    expect(range.from).toBe("2026-07-07");
    expect(range.to).toBe("2026-08-05");
  });

  it("uses the established timezone fallback for missing or invalid values", () => {
    for (const timezone of [null, "Not/AZone"]) {
      const range = resolveStatisticsDateRange(
        { from: "2026-08-01", to: "2026-08-01" },
        timezone,
      );
      expect(range.timeZone).toBe("Asia/Singapore");
      expect(range.gte.toISOString()).toBe("2026-07-31T16:00:00.000Z");
    }
  });

  it("rejects invalid or inverted direct-call ranges", () => {
    expect(() =>
      resolveStatisticsDateRange(
        { from: "2026-02-30", to: "2026-03-01" },
        "UTC",
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveStatisticsDateRange(
        { from: "2026-08-02", to: "2026-08-01" },
        "UTC",
      ),
    ).toThrow("to must be on or after from");
  });
});
