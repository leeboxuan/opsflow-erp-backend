import { JobMessageImportMovementType, JobType } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  reviewedDraftToCreateJobDto,
} from "./job-message-import.mapping";
import {
  normalizeReviewedDraft,
  validateReviewedDraft,
} from "./job-message-import.validator";
import { resolveReturnDestinationFields } from "../return-destination";
import { CreateJobDto } from "../dto/create-job.dto";

describe("RETURN destination contract", () => {
  const baseReturnReviewed = () =>
    normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.RETURN,
      customerCompanyId: "comp_1",
      pickupAddress1: "DB Warehouse",
      deliveryAddress1: null,
      returningDepotCode: "COG1",
      returningDepotAddress1: "Cogent Yard",
      returningDepotPostal: "629117",
      returningDepotPlaceId: "place-cog",
      returningDepotLat: 1.3,
      returningDepotLng: 103.7,
      items: [
        {
          containerNumber: "UASU1061210",
          sealNumber: null,
          referenceNumber: null,
          quantity: 1,
        },
      ],
    });

  it("maps selected canonical depot into deliveryAddress1 + importDetails", async () => {
    const reviewed = baseReturnReviewed();
    const dto = reviewedDraftToCreateJobDto({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(dto.jobType).toBe(JobType.RETURN);
    expect(dto.deliveryAddress1).toBe("Cogent Yard");
    expect(dto.deliveryPostal).toBe("629117");
    expect(dto.importDetails?.returningDepotCode).toBe("COG1");
    expect(dto.importDetails?.returningDepotAddress1).toBe("Cogent Yard");

    const validated = plainToInstance(CreateJobDto, dto);
    const errors = await validate(validated);
    expect(errors.filter((e) => e.property === "deliveryAddress1")).toHaveLength(0);
  });

  it("uses the latest depot selection when switching depots", () => {
    const first = resolveReturnDestinationFields({
      returningDepotCode: "COG1",
      returningDepotAddress1: "Cogent Jurong",
    });
    const second = resolveReturnDestinationFields({
      returningDepotCode: "COG2",
      returningDepotAddress1: "Cogent Tuas",
      returningDepotPostal: "639123",
    });
    expect(first?.deliveryAddress1).toBe("Cogent Jurong");
    expect(second?.deliveryAddress1).toBe("Cogent Tuas");
    expect(second?.returningDepotCode).toBe("COG2");
    expect(second?.deliveryPostal).toBe("639123");
  });

  it("keeps custom depot address as the destination", async () => {
    const reviewed = normalizeReviewedDraft({
      ...baseReturnReviewed(),
      returningDepotCode: null,
      returningDepotAddress1: "15 Tuas Avenue 18",
      returningDepotPostal: "638905",
      returningDepotPlaceId: null,
    });
    const dto = reviewedDraftToCreateJobDto({
      reviewed,
      timezone: "Asia/Singapore",
    });
    expect(dto.deliveryAddress1).toBe("15 Tuas Avenue 18");
    expect(dto.importDetails?.returningDepotCode).toBeNull();
    expect(dto.importDetails?.returningDepotAddress1).toBe("15 Tuas Avenue 18");
    const errors = await validate(plainToInstance(CreateJobDto, dto));
    expect(errors.filter((e) => e.property === "deliveryAddress1")).toHaveLength(0);
  });

  it("maps canonical pickupReference for non-COLLECTION types and hydrates Collection legacy items", async () => {
    const importReviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Jurong Port",
      deliveryAddress1: "DB Warehouse",
      returningDepotAddress1: "Cogent Yard",
      pickupReference: "PU-IMPORT-9",
      items: [
        {
          containerNumber: "UASU1061210",
          sealNumber: null,
          referenceNumber: null,
          quantity: 1,
        },
      ],
    });
    const importDto = reviewedDraftToCreateJobDto({
      reviewed: importReviewed,
      timezone: "Asia/Singapore",
    });
    expect(importDto.pickupReference).toBe("PU-IMPORT-9");

    const collectionLegacy = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.COLLECTION,
      collectionType: "EMPTY",
      customerCompanyId: "comp_1",
      pickupAddress1: "ALS",
      deliveryAddress1: "Customer",
      items: [
        {
          containerNumber: null,
          sealNumber: null,
          referenceNumber: "SGBKKCAE9294",
          quantity: 1,
        },
      ],
    });
    expect(collectionLegacy.pickupReference).toBe("SGBKKCAE9294");
    const collectionDto = reviewedDraftToCreateJobDto({
      reviewed: collectionLegacy,
      timezone: "Asia/Singapore",
    });
    expect(collectionDto.pickupReference).toBe("SGBKKCAE9294");
  });

  it("fails clearly when RETURN depot destination is missing", () => {
    expect(
      resolveReturnDestinationFields({
        returningDepotCode: null,
        returningDepotAddress1: null,
        deliveryAddress1: null,
      }),
    ).toBeNull();
    expect(() =>
      reviewedDraftToCreateJobDto({
        reviewed: normalizeReviewedDraft({
          movementType: JobMessageImportMovementType.RETURN,
          customerCompanyId: "comp_1",
          pickupAddress1: "DB Warehouse",
          deliveryAddress1: null,
          returningDepotAddress1: null,
          returningDepotCode: null,
          items: [
            {
              containerNumber: "UASU1061210",
              sealNumber: null,
              referenceNumber: null,
              quantity: 1,
            },
          ],
        }),
        timezone: "Asia/Singapore",
      }),
    ).toThrow(/MISSING_LOCATION/);
  });

  it("does not treat TBA text as a successful destination without selection", () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.RETURN,
      customerCompanyId: "comp_1",
      pickupAddress1: "DB Warehouse",
      returningDepotAddress1: "TBA (wait carrier)",
      returningDepotCode: null,
      returningDepotVerificationStatus: "UNRESOLVED",
      items: [
        {
          containerNumber: "MSDU7515916",
          sealNumber: null,
          referenceNumber: null,
          quantity: 1,
        },
      ],
    });
    const validation = validateReviewedDraft(reviewed);
    expect(validation.hasBlockingErrors).toBe(true);
    expect(
      validation.fieldErrors.some((e) => e.code === "LOCATION_UNRESOLVED"),
    ).toBe(true);
  });
});
