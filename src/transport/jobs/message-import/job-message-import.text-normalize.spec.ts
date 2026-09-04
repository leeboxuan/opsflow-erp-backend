import {
  normalizeCompanyName,
  normalizeIdentifier,
  normalizeLocationLabel,
  normalizeNotes,
  normalizePersonName,
} from "./job-message-import.text-normalize";

describe("job-message-import text normalize", () => {
  it("title-cases people and companies without damaging acronyms", () => {
    expect(normalizePersonName("john tan")).toBe("John Tan");
    expect(normalizeCompanyName("acme logistics")).toBe("Acme Logistics");
    expect(normalizeCompanyName("ONE HANNOVER")).toBe("ONE HANNOVER");
  });

  it("uppercases operational location acronyms", () => {
    expect(normalizeLocationLabel("psa")).toBe("PSA");
    expect(normalizeLocationLabel("tuas south")).toBe("Tuas South");
    expect(normalizeLocationLabel("PSA Brani")).toBe("PSA Brani");
    expect(normalizeLocationLabel("ONE HANNOVER, 1 HarbourFront Place")).toBe(
      "ONE HANNOVER, 1 HarbourFront Place",
    );
    expect(normalizeLocationLabel("31 jurong port road")).toBe("31 Jurong Port Road");
  });

  it("strips From/To directional prefixes from location labels", () => {
    expect(normalizeLocationLabel("From - DB WHSE")).toBe("DB WHSE");
    expect(normalizeLocationLabel("to - HOCK CHUAN. 31 JURONG PORT ROAD")).toBe(
      "HOCK CHUAN. 31 JURONG PORT ROAD",
    );
    expect(normalizeLocationLabel("from: EK 30 pioneer sector 2")).toMatch(/Pioneer Sector 2/i);
  });

  it("preserves container codes and acronyms in notes", () => {
    expect(normalizeNotes("wait at psa for gesu6311344")).toBe("wait at PSA for GESU6311344");
    expect(normalizeIdentifier("gesu6311344")).toBe("GESU6311344");
  });
});
