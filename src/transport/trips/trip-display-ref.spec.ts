import { buildTripDisplayRef } from "./trip-display-ref";

describe("buildTripDisplayRef", () => {
  it("compresses parseable internal ref and appends sequence", () => {
    expect(
      buildTripDisplayRef({
        jobInternalRef: "WF-2026-04-0002-IMP",
        tripSequence: 3,
        tripId: "cmok4tpjs000pkq5j53kefqnc",
      }),
    ).toBe("WF-0002-IMP-T03");
  });

  it("supports new WFL internal ref prefix", () => {
    expect(
      buildTripDisplayRef({
        jobInternalRef: "WFL-2026-05-0010-LCL",
        tripSequence: 1,
        tripId: "cmok4tpjs000pkq5j53kefqnc",
      }),
    ).toBe("WFL-0010-LCL-T01");
  });

  it("supports LCL format", () => {
    expect(
      buildTripDisplayRef({
        jobInternalRef: "WF-2026-04-0012-LCL",
        tripSequence: 1,
        tripId: "cmok4tpjs000pkq5j53kefqnc",
      }),
    ).toBe("WF-0012-LCL-T01");
  });

  it("supports EXP format with two-digit sequence", () => {
    expect(
      buildTripDisplayRef({
        jobInternalRef: "WF-2026-12-0099-EXP",
        tripSequence: 12,
        tripId: "cmok4tpjs000pkq5j53kefqnc",
      }),
    ).toBe("WF-0099-EXP-T12");
  });

  it("falls back to raw internal ref when unparseable", () => {
    expect(
      buildTripDisplayRef({
        jobInternalRef: "ABC123",
        tripSequence: 2,
        tripId: "cmok4tpjs000pkq5j53kefqnc",
      }),
    ).toBe("ABC123-T02");
  });

  it("falls back to TRIP + last-6 id when no job ref", () => {
    expect(
      buildTripDisplayRef({
        tripId: "cmok4tpjs000pkq5j53kefqnc",
      }),
    ).toBe("TRIP-KEFQNC");
  });

  it("uses jobSequence when tripSequence is missing", () => {
    expect(
      buildTripDisplayRef({
        jobInternalRef: "WF-2026-04-0002-IMP",
        jobSequence: 4,
        tripId: "cmok4tpjs000pkq5j53kefqnc",
      }),
    ).toBe("WF-0002-IMP-T04");
  });
});
