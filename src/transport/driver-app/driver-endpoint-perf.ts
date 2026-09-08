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

export type DriverTripDocUploadPerfContext = {
  endpoint: string;
  tenantId: string;
  jobId: string;
  tripId: string;
  documentType: string;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
};

export type DriverTripDocUploadPerfTimings = {
  requestReceivedMs: number;
  /** Time from service entry to markFileParsed (multer parse happens earlier in the HTTP stack). */
  fileParsedMs: number;
  authDbMs: number;
  storageUploadMs: number;
  dbWriteMs: number;
  sideEffectsMs: number;
  totalMs: number;
};

/** Log a warning when uploads exceed this size (typical uncompressed phone camera JPEG). */
export const DRIVER_TRIP_DOC_LARGE_FILE_BYTES = 2 * 1024 * 1024;

/** Stage timings for driver trip document uploads (no signed URLs or file bytes). */
export function logDriverTripDocUploadPerf(
  context: DriverTripDocUploadPerfContext,
  timings: DriverTripDocUploadPerfTimings,
  extra?: { responseBytes?: number; largeFile?: boolean },
): void {
  if (!isDriverApiPerfLogEnabled()) return;
  console.info("driver_trip_doc_upload_perf", {
    endpoint: context.endpoint,
    tenantId: context.tenantId,
    jobId: context.jobId,
    tripId: context.tripId,
    documentType: context.documentType,
    fileSizeBytes: context.fileSizeBytes ?? null,
    mimeType: context.mimeType ?? null,
    timings,
    ...(extra?.responseBytes != null ? { responseBytes: extra.responseBytes } : {}),
    ...(extra?.largeFile ? { largeFile: true } : {}),
  });
}

export function createDriverTripDocUploadPerfTimer(
  context: DriverTripDocUploadPerfContext,
) {
  const requestReceivedAt = Date.now();
  let fileParsedAt = requestReceivedAt;
  let authDbStartAt = requestReceivedAt;
  let authDbEndAt = requestReceivedAt;
  let storageUploadStartAt = requestReceivedAt;
  let storageUploadEndAt = requestReceivedAt;
  let dbWriteStartAt = requestReceivedAt;
  let dbWriteEndAt = requestReceivedAt;
  let sideEffectsStartAt = requestReceivedAt;
  let sideEffectsEndAt = requestReceivedAt;

  return {
    markFileParsed() {
      fileParsedAt = Date.now();
    },
    markAuthDbStart() {
      authDbStartAt = Date.now();
    },
    markAuthDbEnd() {
      authDbEndAt = Date.now();
    },
    markStorageUploadStart() {
      storageUploadStartAt = Date.now();
    },
    markStorageUploadEnd() {
      storageUploadEndAt = Date.now();
    },
    markDbWriteStart() {
      dbWriteStartAt = Date.now();
    },
    markDbWriteEnd() {
      dbWriteEndAt = Date.now();
    },
    markSideEffectsStart() {
      sideEffectsStartAt = Date.now();
    },
    markSideEffectsEnd() {
      sideEffectsEndAt = Date.now();
    },
    finish(responsePayload?: unknown) {
      const responseSentAt = Date.now();
      const responseBytes =
        responsePayload != null
          ? Buffer.byteLength(JSON.stringify(responsePayload), "utf8")
          : undefined;
      const fileSizeBytes = context.fileSizeBytes ?? 0;
      logDriverTripDocUploadPerf(context, {
        requestReceivedMs: 0,
        fileParsedMs: Math.max(0, fileParsedAt - requestReceivedAt),
        authDbMs: Math.max(0, authDbEndAt - authDbStartAt),
        storageUploadMs: Math.max(0, storageUploadEndAt - storageUploadStartAt),
        dbWriteMs: Math.max(0, dbWriteEndAt - dbWriteStartAt),
        sideEffectsMs: Math.max(0, sideEffectsEndAt - sideEffectsStartAt),
        totalMs: Math.max(0, responseSentAt - requestReceivedAt),
      }, {
        responseBytes,
        largeFile: fileSizeBytes >= DRIVER_TRIP_DOC_LARGE_FILE_BYTES,
      });
    },
  };
}

/** Stage timings for POST .../complete (dev/staging via DRIVER_API_PERF_LOG). */
export function createDriverTripCompletePerfTimer(meta: {
  jobId: string;
  tripId: string;
}) {
  const startedAt = Date.now();
  let loadEndAt = startedAt;
  let requirementsEndAt = startedAt;
  let trailerCheckoutEndAt = startedAt;
  let storageEndAt = startedAt;
  let txEndAt = startedAt;
  let invoiceSyncEndAt = startedAt;
  let responseBuildEndAt = startedAt;
  let hadLegacyTrailerEndUpload = false;

  return {
    markLoadDone() {
      loadEndAt = Date.now();
    },
    markRequirementsDone() {
      requirementsEndAt = Date.now();
    },
    markTrailerCheckoutDone() {
      trailerCheckoutEndAt = Date.now();
    },
    markStorageDone(hadUpload: boolean) {
      storageEndAt = Date.now();
      hadLegacyTrailerEndUpload = hadUpload;
    },
    markTxDone() {
      txEndAt = Date.now();
    },
    markInvoiceSyncDone() {
      invoiceSyncEndAt = Date.now();
    },
    markResponseBuildDone() {
      responseBuildEndAt = Date.now();
    },
    finish() {
      if (!isDriverApiPerfLogEnabled()) return;
      const totalMs = Date.now() - startedAt;
      console.info("[OPSFLOW_PERF_COMPLETE]", {
        endpoint: "POST /api/drivers/jobs/:jobId/trips/:tripId/complete",
        jobId: meta.jobId,
        tripId: meta.tripId,
        hadLegacyTrailerEndUpload,
        timings: {
          loadJobTripMs: Math.max(0, loadEndAt - startedAt),
          requirementsMs: Math.max(0, requirementsEndAt - loadEndAt),
          trailerCheckoutMs: Math.max(0, trailerCheckoutEndAt - requirementsEndAt),
          storageUploadMs: Math.max(0, storageEndAt - trailerCheckoutEndAt),
          dbTransactionMs: Math.max(0, txEndAt - storageEndAt),
          invoiceSyncMs: Math.max(0, invoiceSyncEndAt - txEndAt),
          responseBuildMs: Math.max(0, responseBuildEndAt - invoiceSyncEndAt),
          totalMs,
        },
      });
    },
  };
}
