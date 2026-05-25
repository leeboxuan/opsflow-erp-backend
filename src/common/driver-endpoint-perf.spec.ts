import {
  isDriverApiPerfLogEnabled,
  logDriverEndpointPerf,
  withDriverEndpointPerf,
} from "./driver-endpoint-perf";

describe("driver-endpoint-perf", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("is disabled in production unless DRIVER_API_PERF_LOG=true", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DRIVER_API_PERF_LOG;
    expect(isDriverApiPerfLogEnabled()).toBe(false);
    process.env.DRIVER_API_PERF_LOG = "true";
    expect(isDriverApiPerfLogEnabled()).toBe(true);
  });

  it("withDriverEndpointPerf returns handler result", async () => {
    process.env.NODE_ENV = "test";
    process.env.DRIVER_API_PERF_LOG = "false";
    const result = await withDriverEndpointPerf(
      "GET /api/drivers/jobs/active",
      { date: "2026-05-25" },
      async () => ({ data: [] }),
    );
    expect(result).toEqual({ data: [] });
  });

  it("logDriverEndpointPerf does not include sensitive fields", () => {
    process.env.DRIVER_API_PERF_LOG = "true";
    const spy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    logDriverEndpointPerf({
      endpoint: "GET /api/drivers/trips/:tripId",
      durationMs: 12,
      responseBytes: 400,
      filters: { tripId: "trip-1" },
    });
    expect(spy).toHaveBeenCalledWith(
      "driver_api_perf",
      expect.not.objectContaining({
        signedUrl: expect.anything(),
        apiKey: expect.anything(),
      }),
    );
    spy.mockRestore();
  });
});
