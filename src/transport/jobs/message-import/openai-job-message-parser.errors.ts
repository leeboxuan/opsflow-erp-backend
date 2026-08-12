export type ParserProviderErrorCode =
  | "INPUT_TOO_LARGE"
  | "OPENAI_TIMEOUT"
  | "OPENAI_TOTAL_DEADLINE_EXCEEDED"
  | "OPENAI_RATE_LIMIT"
  | "OPENAI_PROVIDER_UNAVAILABLE"
  | "OPENAI_PROVIDER_FAILURE"
  | "OPENAI_REFUSAL"
  | "OPENAI_INVALID_OUTPUT";

export type ParserTimeoutSource =
  | "abort_signal"
  | "sdk_timeout"
  | "provider_response"
  | "network"
  | "nested_cause"
  | "total_deadline"
  | "unknown";

export type ProviderErrorDiagnosis = {
  code: ParserProviderErrorCode;
  timeoutSource: ParserTimeoutSource | null;
  httpStatus: number | null;
  errorName: string;
  errorCode: string;
  providerRequestId: string | null;
  message: string;
};

type ErrorLike = {
  name?: string;
  message?: string;
  code?: string | number;
  status?: number;
  cause?: unknown;
  request_id?: string;
  error?: { message?: string; type?: string; code?: string };
  headers?: Record<string, string>;
};

export function flattenErrorCauseChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = (current as ErrorLike)?.cause;
  }
  return chain;
}

function readRequestId(entry: ErrorLike): string | null {
  const direct = entry.request_id ?? entry.headers?.["x-request-id"];
  if (direct) return String(direct);
  return null;
}

function isTimeoutLike(entry: ErrorLike): ParserTimeoutSource | null {
  const name = String(entry.name ?? "");
  const code = String(entry.code ?? "").toUpperCase();
  const message = String(entry.message ?? "").toLowerCase();

  if (name === "AbortError" || code === "ATTEMPT_TIMEOUT" || code === "ABORT_ERR") {
    return "abort_signal";
  }
  if (name.includes("Timeout") || name === "APIConnectionTimeoutError") {
    return "sdk_timeout";
  }
  if (code === "ETIMEDOUT" || message.includes("timed out") || message.includes("timeout")) {
    return message.includes("abort") ? "abort_signal" : "sdk_timeout";
  }
  if (Number(entry.status) === 504) {
    return "provider_response";
  }
  return null;
}

function isNetworkLike(entry: ErrorLike): boolean {
  const code = String(entry.code ?? "").toUpperCase();
  const name = String(entry.name ?? "");
  if (code === "ECONNRESET" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNREFUSED") {
    return true;
  }
  return name.includes("APIConnection");
}

export function diagnoseProviderError(err: unknown): ProviderErrorDiagnosis {
  if ((err as ErrorLike)?.code === "OPENAI_INVALID_OUTPUT") {
    return {
      code: "OPENAI_INVALID_OUTPUT",
      timeoutSource: null,
      httpStatus: null,
      errorName: String((err as Error).name ?? "Error"),
      errorCode: "OPENAI_INVALID_OUTPUT",
      providerRequestId: null,
      message: String((err as Error).message ?? "invalid structured output"),
    };
  }

  if ((err as ErrorLike)?.code === "OPENAI_TOTAL_DEADLINE_EXCEEDED") {
    return {
      code: "OPENAI_TOTAL_DEADLINE_EXCEEDED",
      timeoutSource: "total_deadline",
      httpStatus: 504,
      errorName: String((err as Error).name ?? "Error"),
      errorCode: "OPENAI_TOTAL_DEADLINE_EXCEEDED",
      providerRequestId: null,
      message: String((err as Error).message ?? "operation deadline exceeded"),
    };
  }

  const chain = flattenErrorCauseChain(err).map((entry) => entry as ErrorLike);
  const top = (chain[0] ?? {}) as ErrorLike;
  const message = String(top.message ?? top.error?.message ?? "OpenAI provider failure");
  const lower = message.toLowerCase();

  let timeoutSource: ParserTimeoutSource | null = null;
  for (let i = 0; i < chain.length; i++) {
    const source = isTimeoutLike(chain[i] as ErrorLike);
    if (!source) continue;
    timeoutSource = i === 0 ? source : "nested_cause";
    break;
  }

  let httpStatus: number | null = null;
  let providerRequestId: string | null = null;
  for (const entry of chain) {
    if (httpStatus == null && Number.isFinite(Number(entry.status))) {
      httpStatus = Number(entry.status);
    }
    providerRequestId ??= readRequestId(entry);
  }

  if (lower.includes("refus")) {
    return {
      code: "OPENAI_REFUSAL",
      timeoutSource,
      httpStatus,
      errorName: String(top.name ?? "Error"),
      errorCode: String(top.code ?? ""),
      providerRequestId,
      message,
    };
  }

  if (httpStatus === 429) {
    return {
      code: "OPENAI_RATE_LIMIT",
      timeoutSource,
      httpStatus,
      errorName: String(top.name ?? "Error"),
      errorCode: String(top.code ?? ""),
      providerRequestId,
      message,
    };
  }

  if (timeoutSource != null || httpStatus === 504) {
    return {
      code: "OPENAI_TIMEOUT",
      timeoutSource: timeoutSource ?? "provider_response",
      httpStatus: httpStatus ?? 504,
      errorName: String(top.name ?? "Error"),
      errorCode: String(top.code ?? ""),
      providerRequestId,
      message,
    };
  }

  if (
    httpStatus === 502 ||
    httpStatus === 503 ||
    chain.some(isNetworkLike)
  ) {
    return {
      code: "OPENAI_PROVIDER_UNAVAILABLE",
      timeoutSource: null,
      httpStatus,
      errorName: String(top.name ?? "Error"),
      errorCode: String(top.code ?? ""),
      providerRequestId,
      message,
    };
  }

  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || httpStatus === 422) {
    return {
      code: "OPENAI_PROVIDER_FAILURE",
      timeoutSource: null,
      httpStatus,
      errorName: String(top.name ?? "Error"),
      errorCode: String(top.code ?? ""),
      providerRequestId,
      message,
    };
  }

  return {
    code: "OPENAI_PROVIDER_FAILURE",
    timeoutSource,
    httpStatus,
    errorName: String(top.name ?? "Error"),
    errorCode: String(top.code ?? ""),
    providerRequestId,
    message,
  };
}

export function toParserProviderError(diagnosis: ProviderErrorDiagnosis): Error {
  const err = new Error(diagnosis.message);
  err.name = diagnosis.errorName || "Error";
  (err as Error & { code: ParserProviderErrorCode }).code = diagnosis.code;
  return err;
}

export function isNonRetryableProviderError(err: unknown): boolean {
  const diagnosis = diagnoseProviderError(err);
  if (diagnosis.code === "OPENAI_INVALID_OUTPUT" || diagnosis.code === "OPENAI_REFUSAL") {
    return true;
  }
  if (diagnosis.code === "OPENAI_TOTAL_DEADLINE_EXCEEDED") return true;
  if (diagnosis.httpStatus === 400 || diagnosis.httpStatus === 401 || diagnosis.httpStatus === 403) {
    return true;
  }
  if (diagnosis.httpStatus === 422) return true;
  return false;
}

export function isRetryableProviderError(err: unknown): boolean {
  if (isNonRetryableProviderError(err)) return false;
  const diagnosis = diagnoseProviderError(err);
  if (diagnosis.code === "OPENAI_RATE_LIMIT") return false;
  if (
    diagnosis.code === "OPENAI_TIMEOUT" ||
    diagnosis.code === "OPENAI_PROVIDER_UNAVAILABLE"
  ) {
    return true;
  }
  if (diagnosis.httpStatus != null && diagnosis.httpStatus >= 500) return true;
  const chain = flattenErrorCauseChain(err).map((entry) => entry as ErrorLike);
  return chain.some(isNetworkLike);
}

export function formatProviderAttemptFailureLog(params: {
  attempt: number;
  maxAttempts: number;
  model: string;
  configuredTimeoutMs: number;
  elapsedMs: number;
  diagnosis: ProviderErrorDiagnosis;
  correlationId?: string;
  willRetry: boolean;
}): string {
  const {
    attempt,
    maxAttempts,
    model,
    configuredTimeoutMs,
    elapsedMs,
    diagnosis,
    correlationId,
    willRetry,
  } = params;
  return [
    "job-message-parser failure",
    `attempt=${attempt}/${maxAttempts}`,
    `model=${model}`,
    `configuredTimeoutMs=${configuredTimeoutMs}`,
    `elapsedMs=${elapsedMs}`,
    `errorName=${diagnosis.errorName || "Error"}`,
    `errorCode=${diagnosis.errorCode || "none"}`,
    `httpStatus=${diagnosis.httpStatus ?? "none"}`,
    `timeoutSource=${diagnosis.timeoutSource ?? "none"}`,
    `providerRequestId=${diagnosis.providerRequestId ?? "none"}`,
    `mappedCode=${diagnosis.code}`,
    `willRetry=${willRetry}`,
    `corr=${correlationId ?? "none"}`,
  ].join(" ");
}
