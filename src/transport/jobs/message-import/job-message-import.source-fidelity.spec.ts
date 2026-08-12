import { BadRequestException } from "@nestjs/common";

import { FakeJobMessageParser } from "./fake-job-message-parser";
import {
  assertSourceFragmentsTraceable,
  normalizeSourceTextForTraceability,
} from "./job-message-import.source-fidelity";

describe("assertSourceFragmentsTraceable", () => {
  it("accepts fragments that appear in the submitted source text", () => {
    const sourceText = [
      "COL empty collection for Ocean Network Express",
      "COL loaded collection for Maersk Singapore",
      "DEL delivery for Pacific Logistics",
    ].join("\n");

    expect(() =>
      assertSourceFragmentsTraceable(sourceText, [
        { sourceFragment: "empty collection for Ocean Network Express" },
        { sourceFragment: "loaded collection for Maersk Singapore" },
        { sourceFragment: "delivery for Pacific Logistics" },
      ]),
    ).not.toThrow();
  });

  it("rejects fixture fragments that are absent from arbitrary unique input", async () => {
    const sourceText = [
      "UNIQUE-OPS-MESSAGE-7f3a91",
      "COL empty collection for Ocean Network Express",
      "COL loaded collection for Maersk Singapore",
      "DEL delivery for Pacific Logistics",
    ].join("\n");

    const fake = new FakeJobMessageParser();
    const parsed = await fake.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: `${sourceText}\nIMP\n1) GESU6311344 / FJ28581743\nfrom - tuas\nto - db whse`,
    });

    expect(parsed.message.drafts).toHaveLength(1);

    expect(() => assertSourceFragmentsTraceable(sourceText, parsed.message.drafts)).toThrow(
      BadRequestException,
    );
  });

  it("normalizes whitespace before substring checks", () => {
    const sourceText = "Line one\n\nLine   two";
    expect(normalizeSourceTextForTraceability(sourceText)).toBe("line one line two");
    expect(() =>
      assertSourceFragmentsTraceable(sourceText, [{ sourceFragment: "line one line two" }]),
    ).not.toThrow();
  });
});
