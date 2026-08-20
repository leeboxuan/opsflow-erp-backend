import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateTripDocumentRequirementDto,
  PatchTripDocumentRequirementDto,
} from "./job-trip.dto";
import {
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
} from "@prisma/client";

async function validateDto<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
) {
  const dto = plainToInstance(type, plain);
  return validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe("Trip document requirement DTO enum validation", () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it("accepts valid create enums", async () => {
    const errors = await validateDto(CreateTripDocumentRequirementDto, {
      type: TripDocumentType.PERMIT,
      responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
      requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects invalid responsibleUploader on create with validation error", async () => {
    const errors = await validateDto(CreateTripDocumentRequirementDto, {
      type: TripDocumentType.PERMIT,
      responsibleUploader: "OPS_TEAM",
      requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "responsibleUploader")).toBe(true);
  });

  it("rejects invalid requirementStage on create with validation error", async () => {
    const errors = await validateDto(CreateTripDocumentRequirementDto, {
      type: TripDocumentType.PERMIT,
      responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
      requirementStage: "BEFORE_PUBLISH",
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "requirementStage")).toBe(true);
  });

  it("rejects invalid enums on patch", async () => {
    const uploaderErrors = await validateDto(PatchTripDocumentRequirementDto, {
      responsibleUploader: "DRIVER_ONLY",
    });
    expect(uploaderErrors.some((e) => e.property === "responsibleUploader")).toBe(
      true,
    );

    const stageErrors = await validateDto(PatchTripDocumentRequirementDto, {
      requirementStage: "AFTER_COMPLETE",
    });
    expect(stageErrors.some((e) => e.property === "requirementStage")).toBe(true);
  });

  it("ValidationPipe returns BadRequestException (400-class) for invalid create enums", async () => {
    await expect(
      pipe.transform(
        {
          type: TripDocumentType.PERMIT,
          responsibleUploader: "OPS_TEAM",
          requirementStage: "BEFORE_PUBLISH",
        },
        { type: "body", metatype: CreateTripDocumentRequirementDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ValidationPipe returns BadRequestException for invalid patch enums", async () => {
    await expect(
      pipe.transform(
        { requirementStage: "AFTER_COMPLETE" },
        { type: "body", metatype: PatchTripDocumentRequirementDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
