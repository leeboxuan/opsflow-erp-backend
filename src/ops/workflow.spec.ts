import { JobType } from "@prisma/client";
import { tripCreateManyForJob } from "./job-workflow.helpers";
import { parseQuotationRateLinesFromXlsxBuffer } from "../customers/quotation-parse.helpers";

describe("workflow helpers", () => {
  it("tripCreateManyForJob creates two IMPORT legs", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.IMPORT,
      new Date("2026-03-15"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].jobSequence).toBe(1);
    expect(rows[1].jobSequence).toBe(2);
  });

  it("tripCreateManyForJob creates two EXPORT legs", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.EXPORT,
      new Date("2026-03-15"),
    );
    expect(rows).toHaveLength(2);
  });

  it("parseQuotationRateLinesFromXlsxBuffer returns empty for invalid buffer", () => {
    expect(parseQuotationRateLinesFromXlsxBuffer(Buffer.from("x"))).toEqual([]);
  });
});

describe("portal user name", () => {
  it("CreateCustomerCompanyUserDto requires name via class-validator", async () => {
    const { validate } = await import("class-validator");
    const { CreateCustomerCompanyUserDto } = await import(
      "../customers/dto/customers.dto"
    );
    const dto = Object.assign(new CreateCustomerCompanyUserDto(), {
      email: "a@b.com",
      password: "longenough",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "name")).toBe(true);
  });
});
