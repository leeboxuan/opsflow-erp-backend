import { statisticsLimitationNote } from "./statistics-limitation-copy";
import {
  displayTripReference,
  inferContainerSizeLabel,
} from "./statistics-references";

describe("statistics presentation helpers", () => {
  it("builds a human trip reference without database ids", () => {
    expect(
      displayTripReference({
        jobNo: "JOB-202608-001",
        jobSequence: 2,
        tripSequence: null,
      }),
    ).toBe("JOB-202608-001 · Trip 2");
  });

  it("infers common container sizes and keeps unknown text", () => {
    expect(inferContainerSizeLabel("20FT")).toBe("20'");
    expect(inferContainerSizeLabel("40HC")).toBe("40HC");
    expect(inferContainerSizeLabel("Open top special")).toBe("Open top special");
    expect(inferContainerSizeLabel(null)).toBe("Unspecified");
  });

  it("translates limitation codes into management language", () => {
    expect(statisticsLimitationNote("cancelled_trip_date_uses_updated_at")).toContain(
      "last-updated date",
    );
    expect(
      statisticsLimitationNote("cancelled_trip_date_uses_updated_at"),
    ).not.toBe("cancelled_trip_date_uses_updated_at");
  });
});
