import {
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";
import {
  aggregateJobDocumentReadiness,
  buildDocumentGapsForStage,
  buildTripCompletionDocumentGapsFromEvaluation,
  driverMayUploadRequirementType,
  evaluateTripDocumentRequirement,
  evaluateTripDocumentRequirements,
} from "./trip-document-requirement-evaluation";

describe("trip-document-requirement-evaluation", () => {
  const deliveryDoReq = {
    id: "req-do",
    type: TripDocumentType.DELIVERY_DO,
    label: "Delivery DO",
    isRequired: true,
    requiresSignature: true,
    minCount: 1,
    sortOrder: 0,
    responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
    requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
  };

  const podReq = {
    id: "req-pod",
    type: TripDocumentType.POD_PHOTO,
    label: "Proof of Delivery Photo",
    isRequired: true,
    requiresSignature: false,
    minCount: 1,
    sortOrder: 1,
    responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
    requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
  };

  const permitReq = {
    id: "req-permit",
    type: TripDocumentType.PERMIT,
    label: "Permit",
    isRequired: true,
    requiresSignature: false,
    minCount: 1,
    sortOrder: 2,
    responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
    requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
  };

  it("counts missing Delivery DO and POD as two gaps (Screenshot B regression)", () => {
    const evaluation = evaluateTripDocumentRequirements({
      tripStatus: TripStatus.PUBLISHED,
      documents: [],
      requirements: [deliveryDoReq, podReq],
    });
    expect(evaluation.totalMissingCount).toBe(2);
    expect(evaluation.missingTypeCodes.sort()).toEqual(
      ["DELIVERY_DO", "POD_PHOTO"].sort(),
    );
    const delivery = evaluation.requirements.find((r) => r.type === "DELIVERY_DO");
    expect(delivery?.satisfiedState).toBe("MISSING");
    expect(delivery?.blockingActor).toBe("DRIVER");
  });

  it("does not treat nonexistent Delivery DO as satisfied", () => {
    const row = evaluateTripDocumentRequirement(deliveryDoReq, []);
    expect(row.satisfiedState).toBe("MISSING");
    expect(row.missingCount).toBe(1);
  });

  it("enforces minCount", () => {
    const row = evaluateTripDocumentRequirement(
      { ...podReq, minCount: 2 },
      [{ type: TripDocumentType.POD_PHOTO, isActive: true }],
    );
    expect(row.satisfiedCount).toBe(1);
    expect(row.missingCount).toBe(1);
    expect(row.satisfiedState).toBe("PARTIAL");
  });

  it("requires canonical signed state for signature requirements", () => {
    const unsigned = evaluateTripDocumentRequirement(deliveryDoReq, [
      { type: TripDocumentType.DELIVERY_DO, isActive: true, isSigned: false },
    ]);
    expect(unsigned.satisfiedState).toBe("UNSIGNED");
    const signed = evaluateTripDocumentRequirement(deliveryDoReq, [
      {
        type: TripDocumentType.DELIVERY_DO,
        isActive: true,
        isSigned: true,
        signedAt: new Date(),
      },
    ]);
    expect(signed.satisfiedState).toBe("SATISFIED");
  });

  it("ignores inactive/replaced documents", () => {
    const row = evaluateTripDocumentRequirement(podReq, [
      { type: TripDocumentType.POD_PHOTO, isActive: false },
    ]);
    expect(row.satisfiedState).toBe("MISSING");
  });

  it("skips container/seal requirement types in trip-level evaluation", () => {
    const evaluation = evaluateTripDocumentRequirements({
      documents: [],
      requirements: [
        podReq,
        {
          id: "req-c",
          type: TripDocumentType.CONTAINER_PHOTO,
          label: "Container photo",
          isRequired: true,
          requiresSignature: false,
          minCount: 1,
          responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
          requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
        },
      ],
    });
    expect(evaluation.requirements.some((r) => r.type === "CONTAINER_PHOTO")).toBe(
      false,
    );
    expect(evaluation.missingTypeCodes).toEqual(["POD_PHOTO"]);
  });

  it("evaluates stages independently for lifecycle gaps", () => {
    const docs = [{ type: TripDocumentType.POD_PHOTO, isActive: true }];
    const requirements = [deliveryDoReq, podReq, permitReq];
    expect(
      buildDocumentGapsForStage(
        docs,
        requirements,
        TripDocumentRequirementStage.BEFORE_DISPATCH,
      ),
    ).toEqual(["PERMIT"]);
    expect(
      buildDocumentGapsForStage(
        docs,
        requirements,
        TripDocumentRequirementStage.BEFORE_COMPLETE,
      ),
    ).toEqual(["DELIVERY_DO"]);
    expect(
      buildDocumentGapsForStage(
        docs,
        requirements,
        TripDocumentRequirementStage.BEFORE_START,
      ),
    ).toEqual([]);
  });

  it("marks Operations as blocking actor for missing permit", () => {
    const evaluation = evaluateTripDocumentRequirements({
      documents: [],
      requirements: [permitReq],
      forStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
    });
    expect(evaluation.readinessStatus).toBe("BLOCKED_BY_OPERATIONS");
    expect(evaluation.blockingActor).toBe("OPERATIONS");
    expect(evaluation.summaryLabels[0]).toContain("Operations");
  });

  it("REFERENCE_ONLY never blocks", () => {
    const evaluation = evaluateTripDocumentRequirements({
      documents: [],
      requirements: [
        {
          ...permitReq,
          requirementStage: TripDocumentRequirementStage.REFERENCE_ONLY,
        },
      ],
    });
    expect(evaluation.missingTypeCodes).toEqual([]);
    expect(evaluation.readinessStatus).toBe("READY");
  });

  it("cancelled trips are UNAVAILABLE with zero missing rollup", () => {
    const evaluation = evaluateTripDocumentRequirements({
      tripStatus: TripStatus.CANCELLED,
      documents: [],
      requirements: [deliveryDoReq, podReq],
    });
    expect(evaluation.readinessStatus).toBe("UNAVAILABLE");
    expect(evaluation.totalMissingCount).toBe(0);
    const rollup = aggregateJobDocumentReadiness([evaluation]);
    expect(rollup.missingDocumentCount).toBe(0);
    expect(rollup.readinessStatus).toBe("UNAVAILABLE");
  });

  it("denies driver upload for OPERATIONS-only permit", () => {
    expect(driverMayUploadRequirementType([permitReq], TripDocumentType.PERMIT)).toBe(
      false,
    );
    expect(
      driverMayUploadRequirementType(
        [
          {
            ...permitReq,
            responsibleUploader: TripDocumentResponsibleUploader.EITHER,
          },
        ],
        TripDocumentType.PERMIT,
      ),
    ).toBe(true);
  });

  it("buildTripCompletionDocumentGapsFromEvaluation matches completion stage", () => {
    const gaps = buildTripCompletionDocumentGapsFromEvaluation(
      [],
      [deliveryDoReq, podReq],
      TripStatus.ONGOING,
    );
    expect(gaps.sort()).toEqual(["DELIVERY_DO", "POD_PHOTO"].sort());
  });

  it("POD_PHOTO is satisfied by POD_PHOTO, not arbitrary OTHER PDF", () => {
    const withPdf = evaluateTripDocumentRequirement(podReq, [
      {
        type: TripDocumentType.OTHER,
        isActive: true,
        mimeType: "application/pdf",
        originalName: "scan.pdf",
      },
    ]);
    expect(withPdf.satisfiedState).toBe("MISSING");

    const withCanonical = evaluateTripDocumentRequirement(podReq, [
      { type: TripDocumentType.POD_PHOTO, isActive: true, mimeType: "image/jpeg" },
    ]);
    expect(withCanonical.satisfiedState).toBe("SATISFIED");
  });

  it("legacy OTHER image classification uses MIME authoritatively with filename fallback", () => {
    const cases: Array<{
      name: string;
      mimeType?: string | null;
      originalName?: string | null;
      qualifies: boolean;
    }> = [
      {
        name: "image MIME with image filename",
        mimeType: "image/jpeg",
        originalName: "pod.jpg",
        qualifies: true,
      },
      {
        name: "image MIME without extension",
        mimeType: "image/png",
        originalName: "legacy-upload",
        qualifies: true,
      },
      {
        name: "PDF MIME with .jpg filename",
        mimeType: "application/pdf",
        originalName: "spoof.jpg",
        qualifies: false,
      },
      {
        name: "missing MIME with .jpg filename",
        mimeType: null,
        originalName: "pod.jpg",
        qualifies: true,
      },
      {
        name: "generic octet-stream with image extension",
        mimeType: "application/octet-stream",
        originalName: "pod.webp",
        qualifies: true,
      },
      {
        name: "generic octet-stream with .pdf",
        mimeType: "application/octet-stream",
        originalName: "scan.pdf",
        qualifies: false,
      },
    ];

    for (const row of cases) {
      const evaluated = evaluateTripDocumentRequirement(podReq, [
        {
          type: TripDocumentType.OTHER,
          isActive: true,
          mimeType: row.mimeType,
          originalName: row.originalName,
        },
      ]);
      expect({
        name: row.name,
        state: evaluated.satisfiedState,
      }).toEqual({
        name: row.name,
        state: row.qualifies ? "SATISFIED" : "MISSING",
      });
    }
  });

  it("legacy no-snapshot uses LEGACY_FALLBACK and requires POD; Delivery DO only if present", () => {
    const photoOnly = evaluateTripDocumentRequirements({
      tripStatus: TripStatus.ONGOING,
      documents: [],
      requirements: [],
    });
    expect(photoOnly.evaluationSource).toBe("LEGACY_FALLBACK");
    expect(photoOnly.missingTypeCodes).toEqual(["POD_PHOTO"]);

    const withDoPresent = evaluateTripDocumentRequirements({
      tripStatus: TripStatus.ONGOING,
      documents: [
        { type: TripDocumentType.DELIVERY_DO, isActive: true, isSigned: false },
      ],
      requirements: [],
    });
    expect(withDoPresent.evaluationSource).toBe("LEGACY_FALLBACK");
    expect(withDoPresent.missingTypeCodes.sort()).toEqual(
      ["DELIVERY_DO", "POD_PHOTO"].sort(),
    );
    expect(
      withDoPresent.requirements.find((r) => r.type === "DELIVERY_DO")?.satisfiedState,
    ).toBe("UNSIGNED");
  });

  it("snapshot evaluation reports SNAPSHOT source", () => {
    const evaluation = evaluateTripDocumentRequirements({
      documents: [],
      requirements: [podReq],
    });
    expect(evaluation.evaluationSource).toBe("SNAPSHOT");
  });

  it("mixed active/cancelled trips do not inflate job rollup from cancelled", () => {
    const cancelled = evaluateTripDocumentRequirements({
      tripStatus: TripStatus.CANCELLED,
      documents: [],
      requirements: [deliveryDoReq, podReq],
    });
    const active = evaluateTripDocumentRequirements({
      tripStatus: TripStatus.ONGOING,
      documents: [{ type: TripDocumentType.POD_PHOTO, isActive: true }],
      requirements: [podReq],
    });
    const rollup = aggregateJobDocumentReadiness([cancelled, active]);
    expect(rollup.missingDocumentCount).toBe(0);
    expect(rollup.readinessStatus).toBe("READY");
  });
});
