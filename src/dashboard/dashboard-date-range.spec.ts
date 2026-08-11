import { BadRequestException } from "@nestjs/common";
import {
  getTenantLocalTodayKey,
  resolveDashboardDateRange,
} from "./dashboard-date-range";

describe("resolveDashboardDateRange", () => {
  const now = new Date("2026-08-11T10:30:00.000Z");

  it("defaults both omitted params to tenant-local Today", () => {
    const range = resolveDashboardDateRange({}, "Asia/Singapore", now);
    expect(range.from).toBe("2026-08-11");
    expect(range.to).toBe("2026-08-11");
    expect(range.timeZone).toBe("Asia/Singapore");
    expect(range.gte.toISOString()).toBe("2026-08-10T16:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-08-11T16:00:00.000Z");
  });

  it("uses exclusive upper bound for Asia/Singapore day boundaries", () => {
    const range = resolveDashboardDateRange(
      { from: "2026-08-01", to: "2026-08-01" },
      "Asia/Singapore",
      now,
    );
    expect(range.gte.toISOString()).toBe("2026-07-31T16:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-08-01T16:00:00.000Z");
  });

  it("uses the established timezone fallback for missing or invalid values", () => {
    for (const timezone of [null, undefined, "Not/AZone", "   "]) {
      const range = resolveDashboardDateRange(
        { from: "2026-08-01", to: "2026-08-01" },
        timezone,
        now,
      );
      expect(range.timeZone).toBe("Asia/Singapore");
      expect(range.gte.toISOString()).toBe("2026-07-31T16:00:00.000Z");
    }
  });

  it("rejects when only one of from/to is supplied", () => {
    expect(() =>
      resolveDashboardDateRange({ from: "2026-08-01" }, "UTC", now),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveDashboardDateRange({ to: "2026-08-01" }, "UTC", now),
    ).toThrow("from and to must both be provided or both omitted");
  });

  it("rejects invalid dates and reversed ranges", () => {
    expect(() =>
      resolveDashboardDateRange(
        { from: "2026-02-30", to: "2026-03-01" },
        "UTC",
        now,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveDashboardDateRange(
        { from: "2026-08-02", to: "2026-08-01" },
        "UTC",
        now,
      ),
    ).toThrow("to must be on or after from");
  });

  it("getTenantLocalTodayKey respects timezone calendar day", () => {
    // 2026-08-10 20:00 UTC = 2026-08-11 04:00 in Singapore
    const singaporeMorning = new Date("2026-08-10T20:00:00.000Z");
    expect(getTenantLocalTodayKey("Asia/Singapore", singaporeMorning)).toBe(
      "2026-08-11",
    );
    expect(getTenantLocalTodayKey("UTC", singaporeMorning)).toBe("2026-08-10");
  });
});
