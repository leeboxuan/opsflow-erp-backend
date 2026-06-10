import {
  normalizeOptionalNotes,
  resolveTripNotesResponseFields,
} from "./trip-notes.helpers";

describe("trip-notes.helpers", () => {
  it("normalizes empty notes to null", () => {
    expect(normalizeOptionalNotes("")).toBeNull();
    expect(normalizeOptionalNotes("   ")).toBeNull();
    expect(normalizeOptionalNotes(null)).toBeNull();
    expect(normalizeOptionalNotes(undefined)).toBeNull();
  });

  it("trims non-empty notes", () => {
    expect(normalizeOptionalNotes("  call first  ")).toBe("call first");
  });

  it("exposes trip notes separately from job notes", () => {
    const fields = resolveTripNotesResponseFields(
      { notes: "Trip-specific" },
      { notes: "Job-level" },
    );
    expect(fields.notes).toBe("Trip-specific");
    expect(fields.jobNotes).toBe("Job-level");
    expect(fields.tripInstruction).toBe("Job-level");
  });
});
