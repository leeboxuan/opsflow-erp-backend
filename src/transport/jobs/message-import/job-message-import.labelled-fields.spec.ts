import {
  addressContainsTimingExpression,
  extractLabelledInstructions,
  mergeInstructions,
  splitLocationFromTiming,
} from "./job-message-import.labelled-fields";

describe("splitLocationFromTiming", () => {
  it.each([
    ["PSA, 13/08 @ 2300", "PSA", "13/08 @ 2300"],
    ["PSA 13/08@2300", "PSA", "13/08@2300"],
    ["PSA, 13/08 2300", "PSA", "13/08 2300"],
    ["PSA tomorrow 9am", "PSA", "tomorrow 9am"],
    ["PSA, 14/08 before 1200", "PSA", "14/08 before 1200"],
    ["PSA, 14/08 between 1400-1500", "PSA", "14/08 between 1400-1500"],
    ["10 Pioneer Sector 2", "10 Pioneer Sector 2", null],
    ["Micron, 1 north coast drive", "Micron, 1 north coast drive", null],
  ])("splits %j into location=%j timing=%j", (raw, location, timing) => {
    expect(splitLocationFromTiming(raw)).toEqual({ location, timingText: timing });
  });
});

describe("extractLabelledInstructions", () => {
  it("extracts singular and plural instruction labels", () => {
    const text = [
      "Pickup: PSA, 13/08 @ 2300",
      "Instruction: Call PIC 30 minutes before arrival.",
      "Notes: Gate pass required.",
      "Note: Ring bell twice.",
      "Instructions: Wait at guardhouse.",
    ].join("\n");
    expect(extractLabelledInstructions(text)).toEqual([
      "Call PIC 30 minutes before arrival.",
      "Gate pass required.",
      "Ring bell twice.",
      "Wait at guardhouse.",
    ]);
  });

  it("preserves order and skips duplicates", () => {
    const text = [
      "Instruction: Alpha.",
      "Instruction: Beta.",
      "Instruction: Alpha.",
    ].join("\n");
    expect(extractLabelledInstructions(text)).toEqual(["Alpha.", "Beta."]);
  });
});

describe("mergeInstructions", () => {
  it("merges arrays in order without duplicates", () => {
    expect(
      mergeInstructions(["A"], ["B", "A"], extractLabelledInstructions("Instruction: C")),
    ).toEqual(["A", "B", "C"]);
  });
});

describe("addressContainsTimingExpression", () => {
  it("detects embedded timing in addresses", () => {
    expect(addressContainsTimingExpression("PSA, 13/08 @ 2300")).toBe(true);
    expect(addressContainsTimingExpression("PSA")).toBe(false);
    expect(addressContainsTimingExpression("10 Pioneer Sector 2")).toBe(false);
  });
});
