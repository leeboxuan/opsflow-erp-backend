import {
  KNOWN_PRODUCTION_HOSTS,
  assertConfirmedUatDatabase,
  assertE2eSafety,
  assertE2eSafetyOrResult,
} from "./e2e-safety";

const validEnv = {
  OPSFLOW_E2E_ALLOW_MUTATIONS: "true",
  E2E_ALLOWED_WEB_ORIGINS: "http://localhost:3000",
  E2E_ALLOWED_API_BASE_URLS: "http://localhost:3001/api",
  E2E_ALLOWED_TENANT_SLUG: "e2e-uat",
  NODE_ENV: "test",
};

describe("E2E safety gate", () => {
  it("allows a local UAT-shaped configuration", () => {
    const result = assertE2eSafety({
      env: validEnv,
      webOrigin: "http://localhost:3000",
      apiBaseUrl: "http://localhost:3001/api",
      runtimeTenantSlug: "e2e-uat",
    });
    expect(result.ok).toBe(true);
    expect(result.tenantSlug).toBe("e2e-uat");
  });

  it("refuses missing mutation opt-in", () => {
    expect(() =>
      assertE2eSafety({ env: { ...validEnv, OPSFLOW_E2E_ALLOW_MUTATIONS: "false" } }),
    ).toThrow(/OPSFLOW_E2E_ALLOW_MUTATIONS/);
  });

  it("refuses known production hosts", () => {
    for (const host of KNOWN_PRODUCTION_HOSTS) {
      const result = assertE2eSafetyOrResult({
        env: {
          ...validEnv,
          E2E_ALLOWED_WEB_ORIGINS: `https://${host}`,
          E2E_WEB_ORIGIN: `https://${host}`,
        },
        webOrigin: `https://${host}`,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("refuses NODE_ENV=production even for localhost", () => {
    expect(() =>
      assertE2eSafety({ env: { ...validEnv, NODE_ENV: "production" } }),
    ).toThrow(/production-shaped/);
  });

  it("refuses a mismatched runtime tenant slug", () => {
    expect(() =>
      assertE2eSafety({
        env: validEnv,
        runtimeTenantSlug: "acme-live",
      }),
    ).toThrow(/does not match E2E_ALLOWED_TENANT_SLUG/);
  });

  it("refuses production-shaped Render API URL even when other flags are valid", () => {
    const result = assertE2eSafetyOrResult({
      env: {
        ...validEnv,
        E2E_ALLOWED_API_BASE_URLS: "https://opsflow-erp-api.onrender.com/api",
      },
      apiBaseUrl: "https://opsflow-erp-api.onrender.com/api",
    });
    expect(result.ok).toBe(false);
  });
});

describe("assertConfirmedUatDatabase", () => {
  it("refuses the production Supabase project ref", () => {
    expect(() =>
      assertConfirmedUatDatabase({
        DATABASE_URL: "postgresql://x@db.qaqmseqfotymmwkmzjsp.supabase.co/postgres",
        SUPABASE_PROJECT_URL: "https://qaqmseqfotymmwkmzjsp.supabase.co",
      }),
    ).toThrow(/production Supabase/);
  });

  it("allows the confirmed UAT project ref", () => {
    expect(() =>
      assertConfirmedUatDatabase({
        DATABASE_URL: "postgresql://x@db.rzvayccekcmkpwfyxuzi.supabase.co/postgres",
        SUPABASE_PROJECT_URL: "https://rzvayccekcmkpwfyxuzi.supabase.co",
      }),
    ).not.toThrow();
  });
});
