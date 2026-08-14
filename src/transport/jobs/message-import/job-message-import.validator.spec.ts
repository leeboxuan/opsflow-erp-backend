import { JobMessageImportMovementType } from "@prisma/client";
import {
  classifyValidationStatus,
  normalizeReviewedDraft,
  validateReviewedDraft,
} from "./job-message-import.validator";
import { JobMessageImportDraftValidationStatus } from "@prisma/client";

function baseDraft(overrides: Record<string, unknown> = {}) {
  return normalizeReviewedDraft({
    movementType: JobMessageImportMovementType.IMPORT,
    collectionType: null,
    customerCompanyId: "comp_1",
    customerNameText: "Acme",
    pickupAddress1: "Tuas",
    deliveryAddress1: "DB warehouse",
    returningDepotAddress1: "Tuas Depot",
    picName: null,
    picPhone: null,
    notes: null,
    instructions: [],
    timingText: null,
    carrierName: null,
    shipper: null,
    vesselName: null,
    voyage: null,
    items: [{ containerNumber: "GESU6311344", sealNumber: "FJ28581743", referenceNumber: null, quantity: 1 }],
    ...overrides,
  });
}

describe("job-message-import.validator", () => {
  it("marks a complete import draft as having no blocking errors", () => {
    const result = validateReviewedDraft(baseDraft());
    expect(result.hasBlockingErrors).toBe(false);
    expect(result.fieldErrors).toEqual([]);
  });

  it("requires customer, pickup, delivery, and items", () => {
    const result = validateReviewedDraft(
      baseDraft({
        customerCompanyId: null,
        pickupAddress1: null,
        deliveryAddress1: null,
        items: [],
      }),
    );
    expect(result.hasBlockingErrors).toBe(true);
    expect(result.fieldErrors.map((e) => e.field).sort()).toEqual([
      "customerCompanyId",
      "deliveryAddress1",
      "items",
      "pickupAddress1",
    ]);
  });

  it("requires collectionType for COLLECTION jobs", () => {
    const result = validateReviewedDraft(
      baseDraft({
        movementType: JobMessageImportMovementType.COLLECTION,
        collectionType: null,
      }),
    );
    expect(result.fieldErrors.some((e) => e.field === "collectionType")).toBe(true);
  });

  it("keeps unknown optional values null instead of inventing them", () => {
    const reviewed = normalizeReviewedDraft(
      baseDraft({ picName: "  ", picPhone: null, notes: "" }),
    );
    expect(reviewed.picName).toBeNull();
    expect(reviewed.picPhone).toBeNull();
    expect(reviewed.notes).toBeNull();
  });

  it("classifies READY vs NEEDS_REVIEW vs POSSIBLE_DUPLICATE", () => {
    expect(
      classifyValidationStatus({
        hasBlockingErrors: true,
        duplicateCandidateCount: 2,
        duplicateOverrideAcknowledged: true,
      }),
    ).toBe(JobMessageImportDraftValidationStatus.NEEDS_REVIEW);
    expect(
      classifyValidationStatus({
        hasBlockingErrors: false,
        duplicateCandidateCount: 1,
        duplicateOverrideAcknowledged: false,
      }),
    ).toBe(JobMessageImportDraftValidationStatus.POSSIBLE_DUPLICATE);
    expect(
      classifyValidationStatus({
        hasBlockingErrors: false,
        duplicateCandidateCount: 1,
        duplicateOverrideAcknowledged: true,
      }),
    ).toBe(JobMessageImportDraftValidationStatus.READY);
  });
});
