import { JobMessageImportMovementType } from "@prisma/client";
import {
  classifyValidationStatus,
  mergeReviewedDraftPatch,
  normalizeReviewedDraft,
  validateReviewedDraft,
} from "./job-message-import.validator";
import { JobMessageImportDraftValidationStatus } from "@prisma/client";
import { reviewedDraftToCreateJobDto } from "./job-message-import.mapping";

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

  it("requires seal number for each IMPORT container independently", () => {
    const result = validateReviewedDraft(
      baseDraft({
        items: [
          { containerNumber: "AAAA1111111", sealNumber: "S1", referenceNumber: null, quantity: 1 },
          { containerNumber: "BBBB2222222", sealNumber: "  ", referenceNumber: null, quantity: 1 },
          { containerNumber: "CCCC3333333", sealNumber: "S3", referenceNumber: null, quantity: 1 },
        ],
      }),
    );
    expect(result.hasBlockingErrors).toBe(true);
    expect(result.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "items.1.sealNumber",
          code: "MISSING_SEAL",
          message: "Seal number is required for this import container.",
        }),
      ]),
    );
    expect(result.fieldErrors.some((e) => e.field === "items.0.sealNumber")).toBe(false);
    expect(result.fieldErrors.some((e) => e.field === "items.2.sealNumber")).toBe(false);
  });

  it("allows COLLECTION drafts without seals", () => {
    const result = validateReviewedDraft(
      baseDraft({
        movementType: JobMessageImportMovementType.COLLECTION,
        collectionType: "EMPTY",
        items: [
          { containerNumber: null, sealNumber: null, referenceNumber: null, quantity: 1 },
        ],
      }),
    );
    expect(result.fieldErrors.some((e) => e.code === "MISSING_SEAL")).toBe(false);
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

  it("EXPORT: Google port selection clears UNRESOLVED and survives confirm mapping", () => {
    const unresolved = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.EXPORT,
      customerCompanyId: "comp_1",
      deliveryAddress1: "Stuffing yard",
      deliveryPostal: "629563",
      deliveryPlaceId: "ChIJ-stuffing",
      portAddress1: "TBA",
      portSourceText: "TBA",
      portPlaceId: null,
      portPostal: null,
      items: [
        {
          containerNumber: "UASU1061210",
          sealNumber: null,
          referenceNumber: null,
          quantity: 1,
        },
      ],
    });
    expect(unresolved.portVerificationStatus).toBe("UNRESOLVED");
    expect(
      validateReviewedDraft(unresolved).fieldErrors.some(
        (e) => e.field === "portAddress1" && e.code === "LOCATION_UNRESOLVED",
      ),
    ).toBe(true);

    const selected = mergeReviewedDraftPatch(unresolved, {
      portAddress1: "PSA Tuas Port Transport Hub, 200 Tuas South Avenue 5",
      portPostal: "639386",
      portPlaceId: "ChIJ-psa-tuas",
      portLat: 1.27,
      portLng: 103.64,
    });
    // placeId+postal alone is reviewable until trusted Places/master confirms.
    expect(selected.portVerificationStatus).toBe("NEEDS_REVIEW");
    expect(validateReviewedDraft(selected).hasBlockingErrors).toBe(false);

    // Stale client status must not win over evidence on normalize.
    const withStaleStatus = normalizeReviewedDraft({
      ...selected,
      portVerificationStatus: "UNRESOLVED",
    });
    expect(withStaleStatus.portVerificationStatus).toBe("NEEDS_REVIEW");

    const dto = reviewedDraftToCreateJobDto({
      reviewed: withStaleStatus,
      timezone: "Asia/Singapore",
    });
    expect(dto.exportDetails?.exportPortAddress1).toBe(
      "PSA Tuas Port Transport Hub, 200 Tuas South Avenue 5",
    );
  });

  it("EXPORT: genuine TBA port remains blocked", () => {
    const reviewed = mergeReviewedDraftPatch(
      normalizeReviewedDraft({
        movementType: JobMessageImportMovementType.EXPORT,
        customerCompanyId: "comp_1",
        deliveryAddress1: "Stuffing yard",
        deliveryPostal: "629563",
        deliveryPlaceId: "ChIJ-stuffing",
        portAddress1: null,
        items: [
          {
            containerNumber: "UASU1061210",
            sealNumber: null,
            referenceNumber: null,
            quantity: 1,
          },
        ],
      }),
      {
        portAddress1: "TBA (wait carrier)",
        portPlaceId: null,
        portPostal: null,
      },
    );
    expect(reviewed.portVerificationStatus).toBe("UNRESOLVED");
    expect(
      validateReviewedDraft(reviewed).fieldErrors.some(
        (e) => e.field === "portAddress1" && e.code === "LOCATION_UNRESOLVED",
      ),
    ).toBe(true);
  });
});
