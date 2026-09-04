import { BadRequestException } from "@nestjs/common";
import { JobType } from "@prisma/client";
import {
  IMPORT_CONTAINER_SEAL_REQUIRED_MESSAGE,
  assertImportContainerSealsRequired,
  parseValidJobItemsFromInput,
} from "./create-job-validation.helpers";

describe("IMPORT container seal requirement", () => {
  it("rejects IMPORT container without seal", () => {
    const rows = parseValidJobItemsFromInput(
      [{ containerNumber: "TGHU1234567", sealNo: null, containerSize: "40ft" }],
      JobType.IMPORT,
    );
    expect(() => assertImportContainerSealsRequired(JobType.IMPORT, rows)).toThrow(
      BadRequestException,
    );
    expect(() => assertImportContainerSealsRequired(JobType.IMPORT, rows)).toThrow(
      IMPORT_CONTAINER_SEAL_REQUIRED_MESSAGE,
    );
  });

  it("rejects whitespace-only seal", () => {
    const rows = parseValidJobItemsFromInput(
      [{ containerNumber: "TGHU1234567", sealNumber: "   ", containerSize: "40ft" }],
      JobType.IMPORT,
    );
    expect(rows[0]?.sealNo).toBeNull();
    expect(() => assertImportContainerSealsRequired(JobType.IMPORT, rows)).toThrow(
      IMPORT_CONTAINER_SEAL_REQUIRED_MESSAGE,
    );
  });

  it("identifies the missing seal among multiple containers", () => {
    const rows = parseValidJobItemsFromInput(
      [
        { containerNumber: "AAAA1111111", sealNo: "S1" },
        { containerNumber: "BBBB2222222", sealNo: "  " },
        { containerNumber: "CCCC3333333", sealNo: "S3" },
      ],
      JobType.IMPORT,
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]?.sealNo).toBeNull();
    expect(() => assertImportContainerSealsRequired(JobType.IMPORT, rows)).toThrow(
      IMPORT_CONTAINER_SEAL_REQUIRED_MESSAGE,
    );
  });

  it("accepts trimmed valid seals for IMPORT", () => {
    const rows = parseValidJobItemsFromInput(
      [
        { containerNumber: "TGHU1", sealNo: "  SEAL-A  " },
        { containerNumber: "TGHU2", sealNumber: "SEAL-B" },
      ],
      JobType.IMPORT,
    );
    expect(rows.map((r) => r.sealNo)).toEqual(["SEAL-A", "SEAL-B"]);
    expect(() => assertImportContainerSealsRequired(JobType.IMPORT, rows)).not.toThrow();
  });

  it("allows COLLECTION null seals", () => {
    const rows = parseValidJobItemsFromInput(
      [{ containerNumber: null, sealNo: null }],
      JobType.COLLECTION,
    );
    expect(() =>
      assertImportContainerSealsRequired(JobType.COLLECTION, rows),
    ).not.toThrow();
  });

  it("does not enforce seal for EXPORT / RETURN / ONE_WAY / LCL", () => {
    for (const jobType of [JobType.EXPORT, JobType.RETURN, JobType.ONE_WAY, JobType.LCL]) {
      const rows = parseValidJobItemsFromInput(
        [{ containerNumber: "TGHU1", sealNo: null, itemCode: "BOX" }],
        jobType,
      );
      expect(() => assertImportContainerSealsRequired(jobType, rows)).not.toThrow();
    }
  });
});
