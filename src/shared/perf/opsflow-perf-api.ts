/**
 * Development-only API timing logs.
 * Enable with OPSFLOW_PERF_API=true, or automatically in NODE_ENV=development.
 * Never log coordinates, tokens, URLs, driver names, or customer details.
 */

export const OPSFLOW_PERF_API_PREFIX = "[OPSFLOW_PERF_API]";

export function isOpsflowPerfApiEnabled(): boolean {
  if (process.env.OPSFLOW_PERF_API === "true") return true;
  if (process.env.OPSFLOW_PERF_API === "false") return false;
  return process.env.NODE_ENV === "development";
}

export type OpsflowPerfApiFields = Record<
  string,
  string | number | boolean | null | undefined
>;

export function opsflowPerfApiLog(
  event: string,
  data?: OpsflowPerfApiFields,
): void {
  if (!isOpsflowPerfApiEnabled()) return;
  if (data) {
    console.info(OPSFLOW_PERF_API_PREFIX, event, data);
    return;
  }
  console.info(OPSFLOW_PERF_API_PREFIX, event);
}

export function jsonResponseBytes(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return 0;
  }
}

export function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}
