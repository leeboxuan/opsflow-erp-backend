import { JobMessageImportMovementType, JobStatus, JobType } from "@prisma/client";
import { reviewedDraftToCanonicalJobCreate } from "./job-message-import.mapping";
import { normalizeReviewedDraft } from "./job-message-import.validator";

describe("reviewedDraftToCanonicalJobCreate", () => {
  it("maps controller-reviewed fields onto canonical Job create data", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Tuas",
      deliveryAddress1: "DB warehouse",
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
      serviceDate: new Date("2026-08-03T00:00:00.000Z"),
    });
    expect(canonical.jobType).toBe(JobType.IMPORT);
    expect(canonical.status).toBe(JobStatus.ONGOING);
    expect(canonical.customerCompanyId).toBe("comp_1");
    expect(canonical.pickupAddress1).toBe("Tuas");
    expect(canonical.deliveryAddress1).toBe("DB warehouse");
    expect(canonical.receiverName).toBe("Shuman");
    expect(canonical.items[0].itemCode).toBe("GESU6311344");
    expect(canonical.items[0].sealNo).toBe("FJ28581743");
    expect(canonical.notes).toContain("morning asap");
    expect(canonical.carrierName).toBe("ocean");
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
      serviceDate: new Date("2026-08-03T00:00:00.000Z"),
    });
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
      items: [{ containerNumber: "GESU6311344", sealNumber: null, referenceNumber: null, quantity: 1 }],
    });
    const canonical = reviewedDraftToCanonicalJobCreate({
      reviewed,
      serviceDate: new Date("2026-08-03T00:00:00.000Z"),
    });
    expect(canonical.pickupAddress1).toBe("CONTROLLER PICKUP");
    expect(canonical.deliveryAddress1).toBe("CONTROLLER DELIVERY");
  });
});
