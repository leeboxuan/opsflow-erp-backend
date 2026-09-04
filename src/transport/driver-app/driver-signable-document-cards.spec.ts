import { TripDocumentType } from "@prisma/client";
import {
  appendMissingRequiredSignableDocumentPlaceholders,
  attachGenerationStatusToTripDocument,
  isDriverEnsureableTripDocumentType,
  missingRequiredDocumentPlaceholderId,
  resolveTripDocumentGenerationStatus,
} from "./driver-signable-document-cards";

describe("driver-signable-document-cards", () => {
  it("recognizes ensureable types", () => {
    expect(isDriverEnsureableTripDocumentType("DELIVERY_DO")).toBe(true);
    expect(isDriverEnsureableTripDocumentType("LORRY_CHIT")).toBe(true);
    expect(isDriverEnsureableTripDocumentType("POD_PHOTO")).toBe(false);
  });

  it("resolves generation statuses", () => {
    expect(
      resolveTripDocumentGenerationStatus({ hasDocument: false }),
    ).toBe("GENERATION_FAILED");
    expect(
      resolveTripDocumentGenerationStatus({
        hasDocument: true,
        isSigned: true,
        requiresSignature: true,
      }),
    ).toBe("SIGNED");
    expect(
      resolveTripDocumentGenerationStatus({
        hasDocument: true,
        isSigned: false,
        requiresSignature: true,
      }),
    ).toBe("AWAITING_SIGNATURE");
    expect(
      resolveTripDocumentGenerationStatus({
        hasDocument: true,
        isSigned: false,
        requiresSignature: false,
      }),
    ).toBe("GENERATED");
  });

  it("appends DO-only and Lorry-only placeholders independently", () => {
    const doOnly = appendMissingRequiredSignableDocumentPlaceholders({
      documents: [],
      requirements: [
        {
          type: TripDocumentType.DELIVERY_DO,
          isRequired: true,
          requiresSignature: true,
          label: "Delivery DO",
        },
      ],
    });
    expect(doOnly).toHaveLength(1);
    expect(doOnly[0]?.type).toBe(TripDocumentType.DELIVERY_DO);
    expect(doOnly[0]?.generationStatus).toBe("GENERATION_FAILED");
    expect(doOnly[0]?.canRetryGenerate).toBe(true);

    const lorryOnly = appendMissingRequiredSignableDocumentPlaceholders({
      documents: [],
      requirements: [
        {
          type: TripDocumentType.LORRY_CHIT,
          isRequired: true,
          requiresSignature: true,
          label: "Lorry Chit",
        },
      ],
    });
    expect(lorryOnly.map((d) => d.type)).toEqual([TripDocumentType.LORRY_CHIT]);

    const both = appendMissingRequiredSignableDocumentPlaceholders({
      documents: [],
      requirements: [
        {
          type: TripDocumentType.DELIVERY_DO,
          isRequired: true,
          requiresSignature: true,
        },
        {
          type: TripDocumentType.LORRY_CHIT,
          isRequired: true,
          requiresSignature: true,
        },
      ],
    });
    expect(both.map((d) => d.type).sort()).toEqual([
      TripDocumentType.DELIVERY_DO,
      TripDocumentType.LORRY_CHIT,
    ]);
  });

  it("does not append placeholders when neither is required", () => {
    const rows = appendMissingRequiredSignableDocumentPlaceholders({
      documents: [{ id: "pod", type: TripDocumentType.POD_PHOTO }],
      requirements: [
        {
          type: TripDocumentType.POD_PHOTO,
          isRequired: true,
          requiresSignature: false,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe(TripDocumentType.POD_PHOTO);
  });

  it("does not duplicate when an active document already exists", () => {
    const rows = appendMissingRequiredSignableDocumentPlaceholders({
      documents: [
        {
          id: "doc-1",
          type: TripDocumentType.LORRY_CHIT,
          status: "UPLOADED",
        },
      ],
      requirements: [
        {
          type: TripDocumentType.LORRY_CHIT,
          isRequired: true,
          requiresSignature: true,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("doc-1");
  });

  it("attaches awaiting signature status for unsigned required docs", () => {
    const enriched = attachGenerationStatusToTripDocument(
      {
        id: "doc-1",
        type: TripDocumentType.DELIVERY_DO,
        isSigned: false,
        requiresSignature: true,
      },
      [
        {
          type: TripDocumentType.DELIVERY_DO,
          isRequired: true,
          requiresSignature: true,
        },
      ],
    );
    expect(enriched.generationStatus).toBe("AWAITING_SIGNATURE");
    expect(enriched.canRetryGenerate).toBe(false);
  });

  it("marks placeholders as retryable generation failures", () => {
    const enriched = attachGenerationStatusToTripDocument({
      id: missingRequiredDocumentPlaceholderId(TripDocumentType.LORRY_CHIT),
      type: TripDocumentType.LORRY_CHIT,
      requiresSignature: true,
    });
    expect(enriched.generationStatus).toBe("GENERATION_FAILED");
    expect(enriched.canRetryGenerate).toBe(true);
  });
});
