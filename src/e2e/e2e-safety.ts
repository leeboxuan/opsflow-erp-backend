/**
 * Shared E2E mutation safety gate.
 * Used by Playwright, Maestro orchestration, reset, and fixture scripts.
 */

export const E2E_DEFAULT_TENANT_SLUG = "e2e-uat";
export const E2E_DEFAULT_TENANT_NAME = "OpsFlow E2E Logistics";
export const E2E_OWNERSHIP_PREFIX = "E2E-";
export const E2E_OWNERSHIP_NAME_PREFIX = "E2E ";

export const KNOWN_PRODUCTION_HOSTS = [
  "opsflow-erp-web.onrender.com",
  "opsflow-erp-api.onrender.com",
] as const;

/** Confirmed UAT Supabase project. Production is a different project. */
export const E2E_UAT_SUPABASE_REF = "rzvayccekcmkpwfyxuzi";
export const E2E_FORBIDDEN_PRODUCTION_SUPABASE_REF = "qaqmseqfotymmwkmzjsp";

export type E2eSafetyEnv = Record<string, string | undefined>;

export type E2eSafetyInput = {
  env?: E2eSafetyEnv;
  webOrigin?: string | null;
  apiBaseUrl?: string | null;
  runtimeTenantSlug?: string | null;
};

export type E2eSafetyOk = {
  ok: true;
  tenantSlug: string;
  webOrigins: string[];
  apiBaseUrls: string[];
};

export type E2eSafetyFail = {
  ok: false;
  errors: string[];
};

const PROD_ENV_VALUES = new Set(["production", "prod"]);

function readEnv(env: E2eSafetyEnv, key: string): string {
  return String(env[key] ?? "").trim();
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "").toLowerCase();
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() ?? value;
  }
}

function isProductionShaped(env: E2eSafetyEnv, urls: string[]): boolean {
  for (const key of ["NODE_ENV", "APP_ENV", "OPSFLOW_ENV", "ENVIRONMENT"]) {
    if (PROD_ENV_VALUES.has(readEnv(env, key).toLowerCase())) return true;
  }
  return urls.some((url) => {
    const host = hostnameOf(url);
    return KNOWN_PRODUCTION_HOSTS.some((blocked) => host === blocked);
  });
}

export function assertConfirmedUatDatabase(env: E2eSafetyEnv = process.env): void {
  const blob = [
    env.DATABASE_URL,
    env.DIRECT_URL,
    env.SUPABASE_PROJECT_URL,
    env.SUPABASE_URL,
  ]
    .map((value) => String(value ?? ""))
    .join(" ");
  if (blob.includes(E2E_FORBIDDEN_PRODUCTION_SUPABASE_REF)) {
    throw new Error("E2E safety gate failed: refusing production Supabase project.");
  }
  if (!blob.includes(E2E_UAT_SUPABASE_REF)) {
    throw new Error(
      "E2E safety gate failed: DATABASE_URL / SUPABASE_PROJECT_URL must target the confirmed UAT project.",
    );
  }
}

export function e2eSafetyEnvForScripts(env: E2eSafetyEnv = process.env): E2eSafetyEnv {
  return {
    ...env,
    NODE_ENV: "test",
    APP_ENV: env.APP_ENV || "uat",
    OPSFLOW_ENV: env.OPSFLOW_ENV || "uat",
  };
}

export function assertE2eSafety(input: E2eSafetyInput = {}): E2eSafetyOk {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const errors: string[] = [];

  if (readEnv(env, "OPSFLOW_E2E_ALLOW_MUTATIONS") !== "true") {
    errors.push("OPSFLOW_E2E_ALLOW_MUTATIONS must be exactly \"true\".");
  }

  const webOrigins = splitList(readEnv(env, "E2E_ALLOWED_WEB_ORIGINS"));
  const apiBaseUrls = splitList(readEnv(env, "E2E_ALLOWED_API_BASE_URLS"));
  const allowedSlug = readEnv(env, "E2E_ALLOWED_TENANT_SLUG");

  if (webOrigins.length === 0) errors.push("E2E_ALLOWED_WEB_ORIGINS is required.");
  if (apiBaseUrls.length === 0) errors.push("E2E_ALLOWED_API_BASE_URLS is required.");
  if (!allowedSlug) errors.push("E2E_ALLOWED_TENANT_SLUG is required.");

  const webOrigin = String(input.webOrigin ?? readEnv(env, "E2E_WEB_ORIGIN") ?? "").trim();
  const apiBaseUrl = String(input.apiBaseUrl ?? readEnv(env, "E2E_API_BASE_URL") ?? "").trim();
  const runtimeSlug = String(
    input.runtimeTenantSlug ?? readEnv(env, "E2E_RUNTIME_TENANT_SLUG") ?? allowedSlug,
  ).trim();

  if (webOrigin) {
    const allowed = webOrigins.map(normalizeUrl);
    if (!allowed.includes(normalizeUrl(webOrigin))) {
      errors.push(`Web origin ${webOrigin} is not in E2E_ALLOWED_WEB_ORIGINS.`);
    }
  }

  if (apiBaseUrl) {
    const allowed = apiBaseUrls.map(normalizeUrl);
    if (!allowed.includes(normalizeUrl(apiBaseUrl))) {
      errors.push(`API base ${apiBaseUrl} is not in E2E_ALLOWED_API_BASE_URLS.`);
    }
  }

  if (runtimeSlug && allowedSlug && runtimeSlug !== allowedSlug) {
    errors.push(
      `Runtime tenant slug "${runtimeSlug}" does not match E2E_ALLOWED_TENANT_SLUG "${allowedSlug}".`,
    );
  }

  const inspectedUrls = [...webOrigins, ...apiBaseUrls, webOrigin, apiBaseUrl].filter(Boolean);
  if (isProductionShaped(env, inspectedUrls)) {
    errors.push(
      "Refusing production-shaped E2E target (NODE_ENV/APP_ENV/OPSFLOW_ENV/ENVIRONMENT or known Render production hosts).",
    );
  }

  if (errors.length > 0) {
    throw new Error(`E2E safety gate failed:\n- ${errors.join("\n- ")}`);
  }

  return {
    ok: true,
    tenantSlug: allowedSlug,
    webOrigins,
    apiBaseUrls,
  };
}

export function assertE2eSafetyOrResult(input: E2eSafetyInput = {}): E2eSafetyOk | E2eSafetyFail {
  try {
    return assertE2eSafety(input);
  } catch (error) {
    return {
      ok: false,
      errors: String(error instanceof Error ? error.message : error)
        .replace(/^E2E safety gate failed:\n- /, "")
        .split("\n- "),
    };
  }
}
