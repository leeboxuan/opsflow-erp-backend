import { parseOperationalTiming } from "./job-message-import.timing";

const TZ = "Asia/Singapore";
const REFERENCE = "2026-08-01";

describe("parseOperationalTiming", () => {
  it("resolves PSA 12/08@2300 in the operating year", () => {
    const result = parseOperationalTiming({
      text: "PSA 12/08@2300",
      referenceDate: REFERENCE,
      timezone: TZ,
    });
    expect(result.locationHint).toBe("PSA");
    expect(result.pickupDateLocal).toBe("2026-08-12T23:00");
    expect(result.display).toBe("12 August 2026, 11:00 PM");
    expect(result.needsReview).toBe(false);
  });

  it("supports common variants", () => {
    expect(
      parseOperationalTiming({ text: "12/8 2300", referenceDate: REFERENCE, timezone: TZ })
        .pickupDateLocal,
    ).toBe("2026-08-12T23:00");
    expect(
      parseOperationalTiming({ text: "12 Aug @ 11pm", referenceDate: REFERENCE, timezone: TZ })
        .pickupDateLocal,
    ).toBe("2026-08-12T23:00");
    expect(
      parseOperationalTiming({
        text: "12th August 2026, 11pm",
        referenceDate: REFERENCE,
        timezone: TZ,
      }).pickupDateLocal,
    ).toBe("2026-08-12T23:00");
    expect(
      parseOperationalTiming({
        text: "tomorrow 9am",
        referenceDate: "2026-08-12",
        timezone: TZ,
      }).pickupDateLocal,
    ).toBe("2026-08-13T09:00");
  });

  it("flags ambiguous windows and deadlines as needs review", () => {
    expect(
      parseOperationalTiming({ text: "before 1700", referenceDate: REFERENCE, timezone: TZ })
        .needsReview,
    ).toBe(true);
    expect(
      parseOperationalTiming({ text: "8-10am", referenceDate: REFERENCE, timezone: TZ }).needsReview,
    ).toBe(true);
    expect(
      parseOperationalTiming({ text: "before 1700", referenceDate: REFERENCE, timezone: TZ })
        .pickupDateLocal,
    ).toBeNull();
  });

  it("does not map detention phrases into requested pickup midnight", () => {
    const result = parseOperationalTiming({
      text: "det 04/09",
      referenceDate: REFERENCE,
      timezone: TZ,
    });
    expect(result.pickupDateLocal).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.reason).toMatch(/detention/i);
    expect(result.display).toMatch(/detention/i);
  });

  it("does not invent midnight when a date has no time", () => {
    const result = parseOperationalTiming({
      text: "04/09",
      referenceDate: "2026-09-01",
      timezone: TZ,
    });
    expect(result.pickupDateLocal).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.display).toMatch(/time not specified/i);
  });
});
