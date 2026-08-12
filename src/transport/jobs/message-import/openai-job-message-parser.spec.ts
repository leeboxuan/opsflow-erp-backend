import { OpenAIJobMessageParser, isRetryableProviderError } from "./openai-job-message-parser";

function jsonResponse(obj: unknown) {
  return {
    id: "resp_1",
    output_text: JSON.stringify(obj),
    usage: { input_tokens: 11, output_tokens: 22 },
  };
}

const validPayload = {
  parserVersion: "opsflow.job_message_parser.v1",
  drafts: [
    {
      clientDraftId: "d1",
      movementType: "IMPORT",
      customerNameText: null,
      earliestAt: null,
      latestAt: null,
      timingText: null,
      pickup: { rawText: "tuas" },
      delivery: { rawText: "db" },
      carrier: null,
      shipper: null,
      vessel: null,
      voyage: null,
      containerSizeType: null,
      items: [{ containerNumber: "GESU6311344", sealNumber: null, referenceNumber: null, quantity: 1 }],
      picName: null,
      picPhone: null,
      instructions: [],
      notes: null,
      sourceFragment: "IMP GESU6311344",
      fieldEvidence: [],
      warnings: [],
    },
  ],
  batchWarnings: [],
};

describe("OpenAIJobMessageParser", () => {
  it("parses strict structured output and records safe metadata", async () => {
    const create = jest.fn().mockResolvedValue(jsonResponse(validPayload));
    const logger = { warn: jest.fn(), error: jest.fn() };
    const parser = new OpenAIJobMessageParser({
      apiKey: "sk-test",
      model: "gpt-test",
      client: { responses: { create } } as any,
      logger,
    });
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: "IMP GESU6311344 from tuas",
      correlationId: "corr-1",
    });
    expect(result.message.drafts).toHaveLength(1);
    expect(result.meta.modelName).toBe("gpt-test");
    expect(result.meta.usage?.inputTokens).toBe(11);
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("GESU6311344");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("GESU6311344");
  });

  it("retries once for timeout then succeeds", async () => {
    const timeout: any = new Error("timeout");
    timeout.code = "ETIMEDOUT";
    const create = jest
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(jsonResponse(validPayload));
    const logger = { warn: jest.fn(), error: jest.fn() };
    const parser = new OpenAIJobMessageParser({
      apiKey: "sk-test",
      model: "gpt-test",
      client: { responses: { create } } as any,
      logger,
    });
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: "hello",
    });
    expect(result.message.drafts).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not retry invalid structured output", async () => {
    const create = jest.fn().mockResolvedValue({ output_text: "not-json" });
    const parser = new OpenAIJobMessageParser({
      apiKey: "sk-test",
      model: "gpt-test",
      client: { responses: { create } } as any,
      logger: { warn: jest.fn(), error: jest.fn() },
    });
    await expect(
      parser.parse({
        tenantId: "t1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP",
        sourceText: "hello",
      }),
    ).rejects.toMatchObject({ code: "OPENAI_INVALID_OUTPUT" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry 400 errors", async () => {
    const bad: any = new Error("bad request");
    bad.status = 400;
    const create = jest.fn().mockRejectedValue(bad);
    const parser = new OpenAIJobMessageParser({
      apiKey: "sk-test",
      model: "gpt-test",
      client: { responses: { create } } as any,
      logger: { warn: jest.fn(), error: jest.fn() },
    });
    await expect(
      parser.parse({
        tenantId: "t1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP",
        sourceText: "hello",
      }),
    ).rejects.toMatchObject({ code: "OPENAI_PROVIDER_FAILURE" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized input without calling the SDK", async () => {
    const create = jest.fn();
    const parser = new OpenAIJobMessageParser({
      apiKey: "sk-test",
      model: "gpt-test",
      client: { responses: { create } } as any,
    });
    await expect(
      parser.parse({
        tenantId: "t1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP",
        sourceText: "x".repeat(25_000),
      }),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    expect(create).not.toHaveBeenCalled();
  });

  it("classifies retryable provider errors", () => {
    expect(isRetryableProviderError({ status: 429 })).toBe(true);
    expect(isRetryableProviderError({ status: 400 })).toBe(false);
  });
});
