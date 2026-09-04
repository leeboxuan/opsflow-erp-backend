import { controllerJsonFromParsed } from "./job-message-import.service";
import type { JobMessageImportParsedDraft } from "./job-message-parser";

describe("controllerJsonFromParsed labelled field extraction", () => {
  const context = {
    timezone: "Asia/Singapore",
    referenceDate: "2026-08-12",
  };

  it("splits pickup location from operational timing", () => {
    const parsed: JobMessageImportParsedDraft = {
      clientDraftId: "d1",
      movementType: "COLLECTION",
      customerNameText: "Ocean Network Express",
      earliestAt: null,
      latestAt: null,
      timingText: null,
      pickup: { rawText: "PSA, 13/08 @ 2300" },
      delivery: { rawText: "10 Pioneer Sector 2" },
      carrier: null,
      shipper: null,
      vessel: null,
      voyage: null,
      containerSizeType: null,
      items: [],
      picName: null,
      picPhone: null,
      instructions: [],
      notes: null,
      sourceFragment: [
        "COL empty collection for Ocean Network Express",
        "Pickup: PSA, 13/08 @ 2300",
        "Instruction: Call PIC 30 minutes before arrival.",
      ].join("\n"),
      fieldEvidence: [],
      warnings: [],
    };

    const reviewed = controllerJsonFromParsed(parsed, null, context);
    expect(reviewed.pickupAddress1).toBe("PSA");
    expect(reviewed.pickupDateLocal).toBe("2026-08-13T23:00");
    expect(reviewed.pickupDateDisplay).toBe("13 Aug 2026, 11:00 PM");
    expect(reviewed.timingText).toBe("13/08 @ 2300");
    expect(reviewed.instructions).toEqual(["Call PIC 30 minutes before arrival."]);
  });

  it("preserves needs-review timing windows separately from the address", () => {
    const parsed: JobMessageImportParsedDraft = {
      clientDraftId: "d2",
      movementType: "COLLECTION",
      customerNameText: "Maersk Singapore",
      earliestAt: null,
      latestAt: null,
      timingText: null,
      pickup: { rawText: "Tuas Avenue 9, 14/08 before 1200" },
      delivery: { rawText: "DB Schenker warehouse" },
      carrier: null,
      shipper: null,
      vessel: null,
      voyage: null,
      containerSizeType: null,
      items: [],
      picName: null,
      picPhone: null,
      instructions: [],
      notes: null,
      sourceFragment: [
        "COL loaded collection for Maersk Singapore",
        "Note: Ensure seal is intact on collection.",
      ].join("\n"),
      fieldEvidence: [],
      warnings: [],
    };

    const reviewed = controllerJsonFromParsed(parsed, null, context);
    expect(reviewed.pickupAddress1).toBe("Tuas Avenue 9");
    expect(reviewed.timingText).toBe("14/08 before 1200");
    expect(reviewed.pickupDateNeedsReview).toBe(true);
    expect(reviewed.instructions).toEqual(["Ensure seal is intact on collection."]);
  });

  it("splits delivery timing from the delivery address", () => {
    const parsed: JobMessageImportParsedDraft = {
      clientDraftId: "d3",
      movementType: "IMPORT",
      customerNameText: "Pacific Logistics",
      earliestAt: null,
      latestAt: null,
      timingText: null,
      pickup: { rawText: "Jurong Port" },
      delivery: { rawText: "1 North Coast Drive, tomorrow 9am" },
      carrier: null,
      shipper: null,
      vessel: null,
      voyage: null,
      containerSizeType: null,
      items: [],
      picName: null,
      picPhone: null,
      instructions: [],
      notes: null,
      sourceFragment: [
        "DEL delivery for Pacific Logistics",
        "Instructions: Contact receiver upon arrival.",
      ].join("\n"),
      fieldEvidence: [],
      warnings: [],
    };

    const reviewed = controllerJsonFromParsed(parsed, null, context);
    expect(reviewed.deliveryAddress1).toBe("1 North Coast Drive");
    expect(reviewed.deliveryDateLocal).toBe("2026-08-13T09:00");
    expect(reviewed.timingText).toBe("tomorrow 9am");
    expect(reviewed.instructions).toEqual(["Contact receiver upon arrival."]);
  });

  it("maps RETURN destination onto returningDepot and keeps detention out of pickup time", () => {
    const parsed: JobMessageImportParsedDraft = {
      clientDraftId: "ret-1",
      movementType: "RETURN",
      customerNameText: null,
      earliestAt: null,
      latestAt: null,
      timingText: "det 04/09",
      pickup: { rawText: "db whse" },
      delivery: { rawText: "cogent" },
      carrier: null,
      shipper: null,
      vessel: null,
      voyage: null,
      containerSizeType: null,
      items: [
        {
          containerNumber: "UASU1061210",
          sealNumber: null,
          referenceNumber: null,
          quantity: 1,
        },
      ],
      picName: null,
      picPhone: null,
      instructions: [],
      notes: null,
      sourceFragment: "UASU1061210 - det 04/09\nto - cogent",
      fieldEvidence: [],
      warnings: [],
    };

    const reviewed = controllerJsonFromParsed(parsed, null, {
      timezone: "Asia/Singapore",
      referenceDate: "2026-09-01",
    });
    expect(reviewed.movementType).toBe("RETURN");
    expect(reviewed.returningDepotAddress1).toMatch(/cogent/i);
    expect(reviewed.returningDepotSourceText).toMatch(/cogent/i);
    expect(reviewed.deliveryAddress1).toBeNull();
    expect(reviewed.pickupDateLocal).toBeNull();
    expect(reviewed.timingText).toBe("det 04/09");
    expect(reviewed.pickupDateNeedsReview).toBe(false);
    expect(reviewed.pickupDateDisplay).toBeNull();
  });
});
