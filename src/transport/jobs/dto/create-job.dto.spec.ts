import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CollectionType, JobType } from "@prisma/client";
import { CreateJobDto } from "./create-job.dto";

describe("CreateJobDto", () => {
  const basePayload = {
    jobType: JobType.LCL,
    customerCompanyId: "company-1",
    pickupAddress1: "Pickup St",
    deliveryAddress1: "Delivery St",
  };

  it.each([
    JobType.LCL,
    JobType.IMPORT,
    JobType.EXPORT,
    JobType.COLLECTION,
  ])("allows omitting receiverName and receiverPhone for %s", async (jobType) => {
    const dto = plainToInstance(CreateJobDto, {
      ...basePayload,
      jobType,
      ...(jobType === JobType.COLLECTION
        ? { collectionType: CollectionType.EMPTY }
        : {}),
    });
    const errors = await validate(dto);
    const receiverErrors = errors.filter((e) =>
      e.property === "receiverName" || e.property === "receiverPhone",
    );
    expect(receiverErrors).toHaveLength(0);
  });
});
