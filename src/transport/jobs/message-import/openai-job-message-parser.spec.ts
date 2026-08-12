import {
  OpenAIJobMessageParser,
  isRetryableProviderError,
} from "./openai-job-message-parser";

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
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("GESU6311344");
  });

  it("retries once at the application layer for timeout then succeeds", async () => {
    const timeout: any = new Error("Request timed out.");
    timeout.name = "APIConnectionTimeoutError";
    const create = jest
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(jsonResponse(validPayload));
    const logger = { warn: jest.fn(), error: jest.fn() };
    const parser = new OpenAIJobMessageParser({
      apiKey: "sk-test",
      model: "gpt-test",
      maxRetries: 1,
      client: { responses: { create } } as any,
      logger,
    });
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: "hello",
      correlationId: "corr-2",
    });
    expect(result.message.drafts).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain("willRetry=true");
    expect(String(logger.warn.mock.calls[0][0])).toContain("attempt=1/2");
    expect(String(logger.warn.mock.calls[0][0])).toContain("elapsedMs=");
  });

  it("maps nested timeout causes to OPENAI_TIMEOUT after retries are exhausted", async () => {
    const root = new Error("connection failed");
    const nested = new Error("Request timed out.");
    nested.name = "APIConnectionTimeoutError";
    (root as Error & { cause: unknown }).cause = nested;
    const create = jest.fn().mockRejectedValue(root);
    const logger = { warn: jest.fn(), error: jest.fn() };
    const parser = new OpenAIJobMessageParser({
      apiKey: "sk-test",
      model: "gpt-test",
      maxRetries: 1,
      client: { responses: { create } } as any,
      logger,
    });
    await expect(
      parser.parse({
        tenantId: "t1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP",
        sourceText: "hello",
      }),
    ).rejects.toMatchObject({ code: "OPENAI_TIMEOUT" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(String(logger.error.mock.calls[0][0])).toContain("willRetry=false");
    expect(String(logger.error.mock.calls[0][0])).toContain("timeoutSource=nested_cause");
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
    expect(isRetryableProviderError({ status: 503 })).toBe(true);
    expect(isRetryableProviderError({ status: 400 })).toBe(false);
    expect(isRetryableProviderError({ status: 429 })).toBe(false);
  });
});
