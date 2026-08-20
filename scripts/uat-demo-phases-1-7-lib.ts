/**
 * Shared helpers for UAT-DEMO-PHASES-1-7 seed / cleanup.
 * Loads opsflow-erp-backend/.env only — never .env.local.
 */
import fs from "node:fs";
import path from "node:path";
import {
  assertConfirmedUatDatabase,
  E2E_DEFAULT_TENANT_SLUG,
  E2E_UAT_SUPABASE_REF,
} from "../src/e2e/e2e-safety";

export const DEMO_PREFIX = "UAT-DEMO-PHASES-1-7";

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const FORBIDDEN_ENV = path.join(ROOT, ".env.local");

export function loadBackendEnvOnly(): void {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error("STOP: opsflow-erp-backend/.env missing");
  }
  // Presence of .env.local is expected on this machine; never apply it.
  void FORBIDDEN_ENV;
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const key = trimmed.slice(0, i).trim();
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
  process.env.APP_ENV = process.env.APP_ENV || "uat";
  process.env.OPSFLOW_ENV = process.env.OPSFLOW_ENV || "uat";
}

export function assertUatOrStop(): void {
  loadBackendEnvOnly();
  try {
    assertConfirmedUatDatabase();
  } catch (err) {
    console.error("STOP: UAT Supabase project ref could not be proven.");
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(2);
  }
  const blob = [
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
    process.env.SUPABASE_PROJECT_URL,
    process.env.SUPABASE_URL,
  ]
    .map((v) => String(v ?? ""))
    .join(" ");
  if (!blob.includes(E2E_UAT_SUPABASE_REF)) {
    console.error("STOP: expected UAT ref missing after load.");
    process.exit(2);
  }
  console.log(
    JSON.stringify({
      uatRefProven: E2E_UAT_SUPABASE_REF,
      envFile: ".env",
      envLocalLoaded: false,
    }),
  );
}

export function redactId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 8) return `${id[0]}***`;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function demoKey(suffix: string): string {
  return `${DEMO_PREFIX}/${suffix}`;
}

export function demoInvoiceNo(suffix: string): string {
  // Keep invoice numbers unique and cleanup-scoped.
  return `${DEMO_PREFIX}-${suffix}`.replace(/\//g, "-").slice(0, 64);
}

export function tenantSlug(): string {
  return process.env.E2E_ALLOWED_TENANT_SLUG || E2E_DEFAULT_TENANT_SLUG;
}

/** Minimal valid 1×1 PNG (no personal data). */
export const SYNTHETIC_PNG_STORAGE_HINT =
  "synthetic/1x1-png-no-pii.png";

export function demoStorageKey(kind: string, name: string): string {
  return `${DEMO_PREFIX}/${kind}/${name}`;
}
