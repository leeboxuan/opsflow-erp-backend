import {
  diagnoseProviderError,
  flattenErrorCauseChain,
  formatProviderAttemptFailureLog,
  isRetryableProviderError,
} from "./openai-job-message-parser.errors";

describe("openai provider error diagnosis", () => {
  it("walks nested error.cause chains for timeout detection", () => {
    const root = new Error("fetch failed");
    const nested = new Error("Request timed out.");
    nested.name = "APIConnectionTimeoutError";
    (root as Error & { cause: unknown }).cause = nested;

    const chain = flattenErrorCauseChain(root);
    expect(chain).toHaveLength(2);

    const diagnosis = diagnoseProviderError(root);
    expect(diagnosis.code).toBe("OPENAI_TIMEOUT");
    expect(diagnosis.timeoutSource).toBe("nested_cause");
  });

  it("recognizes abort-signal attempt timeouts", () => {
    const err = new Error("OpenAI attempt timed out");
    err.name = "AbortError";
    (err as Error & { code: string }).code = "ATTEMPT_TIMEOUT";

    const diagnosis = diagnoseProviderError(err);
    expect(diagnosis.code).toBe("OPENAI_TIMEOUT");
    expect(diagnosis.timeoutSource).toBe("abort_signal");
  });

  it("maps provider 429 responses to rate limit", () => {
    const err = Object.assign(new Error("rate limit"), { status: 429, request_id: "req_429" });
    const diagnosis = diagnoseProviderError(err);
    expect(diagnosis.code).toBe("OPENAI_RATE_LIMIT");
    expect(diagnosis.providerRequestId).toBe("req_429");
  });

  it("maps network failures to provider unavailable", () => {
    const err = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(diagnoseProviderError(err).code).toBe("OPENAI_PROVIDER_UNAVAILABLE");
    expect(isRetryableProviderError(err)).toBe(true);
  });

  it("does not mark rate limits as retryable", () => {
    const err = Object.assign(new Error("rate limit"), { status: 429 });
    expect(isRetryableProviderError(err)).toBe(false);
  });

  it("formats safe diagnostic logs without sensitive input", () => {
    const line = formatProviderAttemptFailureLog({
      attempt: 2,
      maxAttempts: 2,
      model: "gpt-4.1-mini",
      configuredTimeoutMs: 60_000,
      elapsedMs: 61_234,
      diagnosis: diagnoseProviderError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })),
      correlationId: "corr-1",
      willRetry: false,
    });
    expect(line).toContain("attempt=2/2");
    expect(line).toContain("elapsedMs=61234");
    expect(line).toContain("timeoutSource=");
    expect(line).toContain("willRetry=false");
    expect(line).not.toContain("sk-");
    expect(line).not.toContain("WhatsApp");
  });
});
