import { JobMessageImportMovementType, JobStatus, JobType } from "@prisma/client";
import { reviewedDraftToCanonicalJobCreate, reviewedDraftToCreateJobDto } from "./job-message-import.mapping";
import { normalizeReviewedDraft } from "./job-message-import.validator";

describe("reviewedDraftToCanonicalJobCreate", () => {
  it("maps controller-reviewed fields onto canonical Job create data", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Tuas",
      deliveryAddress1: "DB warehouse",
      returningDepotAddress1: "Tuas Depot",
      picName: "Shuman",
      picPhone: "96440435",
      timingText: "morning asap",
      notes: "wait carrier",
      instructions: ["call PIC"],
      carrierName: "ocean",
      shipper: "nippon",
      vesselName: "ONE HANNOVER",
      voyage: "101W",
      items: [
        { containerNumber: "GESU6311344", sealNumber: "FJ28581743", referenceNumber: null, quantity: 1 },
      ],
    });
    const canonical = reviewedDraftToCanonicalJobCreate({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(canonical.pickupDate).toBeNull();
    expect(canonical.jobType).toBe(JobType.IMPORT);
    expect(canonical.status).toBe(JobStatus.ONGOING);
    expect(canonical.customerCompanyId).toBe("comp_1");
    expect(canonical.pickupAddress1).toBe("Tuas");
    expect(canonical.deliveryAddress1).toBe("DB Warehouse");
    expect(canonical.receiverName).toBe("Shuman");
    expect(canonical.items[0].itemCode).toBe("GESU6311344");
    expect(canonical.items[0].sealNo).toBe("FJ28581743");
    expect(canonical.notes).toContain("morning asap");
    expect(canonical.carrierName).toBe("ocean");
    expect((reviewedDraftToCreateJobDto({ reviewed, timezone: "Asia/Singapore" }) as any).importDetails.returningDepotAddress1).toBe(
      "Tuas Depot",
    );
  });

  it("rejects IMPORT confirm mapping when seal is missing", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Tuas",
      deliveryAddress1: "DB warehouse",
      returningDepotAddress1: "Tuas Depot",
      items: [
        { containerNumber: "GESU6311344", sealNumber: null, referenceNumber: null, quantity: 1 },
      ],
    });
    expect(() =>
      reviewedDraftToCreateJobDto({ reviewed, timezone: "Asia/Singapore" }),
    ).toThrow(/Seal number is required for this import container/);
  });

  it("does not invent missing PIC values", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.LCL,
      customerCompanyId: "comp_1",
      pickupAddress1: "DB",
      deliveryAddress1: "Micron",
      items: [{ containerNumber: null, sealNumber: null, referenceNumber: "platform", quantity: 1 }],
    });
    const canonical = reviewedDraftToCanonicalJobCreate({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(canonical.pickupDate).toBeNull();
    expect(canonical.jobType).toBe(JobType.LCL);
    expect(canonical.receiverName).toBe("");
    expect(canonical.receiverPhone).toBe("");
    expect(canonical.pickupContactName).toBeNull();
    expect(canonical.pickupContactPhone).toBeNull();
    expect(canonical.status).toBe(JobStatus.ONGOING);
    expect(canonical.collectionType).toBeNull();
  });

  it("never reads parser-only values that the controller did not keep", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "CONTROLLER PICKUP",
      deliveryAddress1: "CONTROLLER DELIVERY",
      returningDepotAddress1: "Tuas Depot",
      items: [{ containerNumber: "GESU6311344", sealNumber: "FJ28581743", referenceNumber: null, quantity: 1 }],
    });
    const canonical = reviewedDraftToCanonicalJobCreate({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(canonical.pickupDate).toBeNull();
    expect(canonical.pickupAddress1).toBe("CONTROLLER PICKUP");
    expect(canonical.deliveryAddress1).toBe("CONTROLLER DELIVERY");
  });

  it("EXPORT mapping fills depot, customer, and port without substituting customer for port", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.EXPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "PSA Empty Depot",
      deliveryAddress1: "Nat Test Company",
      portAddress1: "Pasir Panjang Terminal",
      items: [{ containerNumber: "MSCU1234567", sealNumber: null, referenceNumber: null, quantity: 1 }],
    });
    const dto = reviewedDraftToCreateJobDto({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(dto.pickupAddress1).toBe("PSA Empty Depot");
    expect(dto.deliveryAddress1).toBe("Nat Test Company");
    expect(dto.exportDetails?.exportPortAddress1).toBe("Pasir Panjang Terminal");
    expect(dto.exportDetails?.stuffingAddress1).toBe("Nat Test Company");
    expect(dto.exportDetails?.exportPortAddress1).not.toBe(dto.deliveryAddress1);
  });

  it("maps date-only requested pickup without inventing a clock time flag", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Tuas",
      deliveryAddress1: "DB warehouse",
      returningDepotAddress1: "Tuas Depot",
      pickupDateLocal: "2026-09-04",
      pickupDateDisplay: "4 Sep 2026 · Time not specified",
      pickupDateNeedsReview: false,
      items: [
        { containerNumber: "GESU6311344", sealNumber: "FJ28581743", referenceNumber: null, quantity: 1 },
      ],
    });
    const dto = reviewedDraftToCreateJobDto({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(dto.pickupDateHasTime).toBe(false);
    expect(dto.pickupDate).toBeTruthy();
    const canonical = reviewedDraftToCanonicalJobCreate({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(canonical.pickupDateHasTime).toBe(false);
    expect(canonical.pickupDate).not.toBeNull();
  });

  it("maps date-only requested delivery onto structured deliveryDate fields", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Tuas",
      deliveryAddress1: "DB warehouse",
      returningDepotAddress1: "Tuas Depot",
      deliveryDateLocal: "2026-09-05",
      deliveryDateDisplay: "5 Sep 2026 · Time not specified",
      deliveryDateNeedsReview: false,
      items: [
        { containerNumber: "GESU6311344", sealNumber: "FJ28581743", referenceNumber: null, quantity: 1 },
      ],
    });
    const dto = reviewedDraftToCreateJobDto({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(dto.deliveryDateHasTime).toBe(false);
    expect(dto.deliveryDate).toBeTruthy();
    expect(dto.notes ?? "").not.toMatch(/Delivery:/i);
    const canonical = reviewedDraftToCanonicalJobCreate({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(canonical.deliveryDateHasTime).toBe(false);
    expect(canonical.deliveryDate).not.toBeNull();
  });

  it("maps explicit 08:30 with hasTime true", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Tuas",
      deliveryAddress1: "DB warehouse",
      returningDepotAddress1: "Tuas Depot",
      pickupDateLocal: "2026-09-04T08:30",
      pickupDateNeedsReview: false,
      items: [
        { containerNumber: "GESU6311344", sealNumber: "FJ28581743", referenceNumber: null, quantity: 1 },
      ],
    });
    const dto = reviewedDraftToCreateJobDto({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(dto.pickupDateHasTime).toBe(true);
    expect(dto.pickupDate).toBe("2026-09-04T00:30:00.000Z");
  });
});
