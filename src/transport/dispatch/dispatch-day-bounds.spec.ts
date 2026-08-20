import {
  dateKeyInTenantTimezone,
  tenantOperatingDayBounds,
  todayOperatingDate,
} from "./dispatch-day-bounds";

describe("tenantOperatingDayBounds (Phase 5)", () => {
  it("returns half-open bounds covering Asia/Singapore civil day", () => {
    const { dayStart, dayEnd, timezone, date } = tenantOperatingDayBounds(
      "2026-08-20",
      "Asia/Singapore",
    );
    expect(timezone).toBe("Asia/Singapore");
    expect(date).toBe("2026-08-20");
    expect(dayStart.toISOString()).toBe("2026-08-19T16:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-08-20T16:00:00.000Z");
    expect(dateKeyInTenantTimezone(dayStart, timezone)).toBe("2026-08-20");
    expect(
      dateKeyInTenantTimezone(new Date(dayEnd.getTime() - 1), timezone),
    ).toBe("2026-08-20");
    expect(dateKeyInTenantTimezone(dayEnd, timezone)).toBe("2026-08-21");
  });

  it("rejects invalid date strings", () => {
    expect(() => tenantOperatingDayBounds("20-08-2026", "Asia/Singapore")).toThrow(
      /Invalid operating date/,
    );
  });

  it("todayOperatingDate returns YYYY-MM-DD", () => {
    expect(todayOperatingDate("Asia/Singapore")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
