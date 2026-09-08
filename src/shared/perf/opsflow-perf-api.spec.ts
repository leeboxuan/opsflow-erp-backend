import {
  isOpsflowPerfApiEnabled,
  jsonResponseBytes,
  OPSFLOW_PERF_API_PREFIX,
  opsflowPerfApiLog,
} from "./opsflow-perf-api";

describe("opsflow-perf-api", () => {
  const originalFlag = process.env.OPSFLOW_PERF_API;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.OPSFLOW_PERF_API = originalFlag;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("is disabled in test unless OPSFLOW_PERF_API=true", () => {
    delete process.env.OPSFLOW_PERF_API;
    process.env.NODE_ENV = "test";
    expect(isOpsflowPerfApiEnabled()).toBe(false);
  });

  it("logs only counts and timings, never sensitive keys", () => {
    process.env.OPSFLOW_PERF_API = "true";
    const spy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    opsflowPerfApiLog("GET /dispatch/board", {
      durationMs: 12,
      activeTripCount: 2,
      responseBytes: 1024,
      googleCalls: 0,
    });
    expect(spy).toHaveBeenCalledWith(
      OPSFLOW_PERF_API_PREFIX,
      "GET /dispatch/board",
      expect.objectContaining({
        durationMs: 12,
        activeTripCount: 2,
        responseBytes: 1024,
        googleCalls: 0,
      }),
    );
    const payload = JSON.stringify(spy.mock.calls[0]);
    expect(payload).not.toMatch(/lat|lng|token|signedUrl|driverName|customer/i);
    spy.mockRestore();
  });

  it("finance and invoice list logs omit payload contents", () => {
    process.env.OPSFLOW_PERF_API = "true";
    const spy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    opsflowPerfApiLog("GET /finance/jobs/summaries", {
      durationMs: 12,
      jobsScanned: 20,
      returned: 20,
      prismaCalls: 6,
    });
    opsflowPerfApiLog("GET /finance/invoices", {
      durationMs: 9,
      invoiceRowsLoaded: 20,
      lineItemRowsLoaded: 0,
      visibilityCandidateCount: 40,
    });
    const payload = JSON.stringify(spy.mock.calls);
    expect(payload).not.toMatch(/invoiceNo|customerName|internalRef|amountCents/i);
    spy.mockRestore();
  });
});
