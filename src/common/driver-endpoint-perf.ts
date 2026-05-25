/**
 * Lightweight driver API timing logs (dev/staging).
 * Enable with DRIVER_API_PERF_LOG=true (never logs tokens or signed URLs).
 */
export function isDriverApiPerfLogEnabled(): boolean {
  if (process.env.DRIVER_API_PERF_LOG === "true") return true;
  return process.env.NODE_ENV !== "production";
}

export type DriverEndpointPerfMeta = {
  endpoint: string;
  durationMs: number;
  responseBytes?: number;
  filters?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export function logDriverEndpointPerf(meta: DriverEndpointPerfMeta): void {
  if (!isDriverApiPerfLogEnabled()) return;
  console.info("driver_api_perf", {
    endpoint: meta.endpoint,
    durationMs: meta.durationMs,
    ...(meta.responseBytes != null ? { responseBytes: meta.responseBytes } : {}),
    ...(meta.filters ? { filters: meta.filters } : {}),
    ...(meta.extra ? { extra: meta.extra } : {}),
  });
}

export async function withDriverEndpointPerf<T>(
  endpoint: string,
  filters: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
  measureBytes?: (result: T) => number | undefined,
): Promise<T> {
  const started = Date.now();
  const result = await fn();
  logDriverEndpointPerf({
    endpoint,
    durationMs: Date.now() - started,
    filters,
    responseBytes: measureBytes?.(result),
  });
  return result;
}
