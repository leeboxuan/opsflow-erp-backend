import { readFileSync } from "fs";
import { join } from "path";

import { JOB_MESSAGE_IMPORT_JSON_SCHEMA } from "./openai-job-message-parser";

describe("OpenAI job message parser production source", () => {
  const src = readFileSync(join(__dirname, "openai-job-message-parser.ts"), "utf8");

  it("has no sample-specific hard-coded message branches", () => {
    expect(src).not.toContain("SGBKKCAE9294");
    expect(src).not.toContain("ALS SUMIRE");
    expect(src).not.toContain("GESU6311344");
    expect(src).not.toContain("six-draft-ops");
    expect(src).not.toContain("acceptance-three-job");
    expect(src).not.toMatch(/sourceText\.includes\(/);
  });

  it("exports a structured schema covering RETURN and ONE_WAY", () => {
    const movement = JOB_MESSAGE_IMPORT_JSON_SCHEMA.schema.properties.drafts.items.properties
      .movementType.enum;
    expect(movement).toEqual(
      expect.arrayContaining(["COLLECTION", "IMPORT", "EXPORT", "RETURN", "ONE_WAY", "LCL"]),
    );
  });
});
