/**
 * Shared helpers for E2E UAT run-owned seed / cleanup.
 * Loads opsflow-erp-backend/.env only — never .env.local.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  assertConfirmedUatDatabase,
  E2E_DEFAULT_TENANT_SLUG,
  E2E_UAT_SUPABASE_REF,
} from "../src/e2e/e2e-safety";

export const RUN_ID_ENV = "E2E_UAT_RUN_ID";

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const FORBIDDEN_ENV = path.join(ROOT, ".env.local");

export const LAST_RUN_JSON_PATH = path.join(ROOT, "scripts", ".e2e-uat-last-run.json");
export const WEB_MANIFEST_PATH = path.resolve(
  ROOT,
  "../opsflow-erp-web-v2/e2e/.auth/uat-run-manifest.json",
);

export type DriverPsaSnapshot = {
  driverId: string;
  userId: string;
  email: string | null;
  previousHasPsaPortAccess: boolean;
  appliedHasPsaPortAccess: boolean;
};

export type UatRunManifest = {
  runId: string;
  operatingDate: string;
  tenantId: string;
  tenantSlug: string;
  customerCompanyId: string;
  customerCompanyCreated: boolean;
  jobIds: Record<string, string>;
  tripIds: Record<string, string>;
  expenseIds: Record<string, string>;
  invoiceNos: string[];
  driverUserIds: { A: string; B: string };
  driverIds: { A: string; B: string };
  psaPrevious: {
    A: DriverPsaSnapshot;
    B: DriverPsaSnapshot;
  };
  scenarios: Record<string, string>;
  createdAt: string;
};

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

export function assertMutationsAllowedOrStop(): void {
  if (process.env.OPSFLOW_E2E_ALLOW_MUTATIONS !== "true") {
    console.error(
      'STOP: OPSFLOW_E2E_ALLOW_MUTATIONS must be exactly "true" for UAT run mutations.',
    );
    process.exit(2);
  }
}

export function redactId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 8) return `${id[0]}***`;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const localRedacted =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;
  return `${localRedacted}@${domain}`;
}

export function tenantSlug(): string {
  return process.env.E2E_ALLOWED_TENANT_SLUG || E2E_DEFAULT_TENANT_SLUG;
}

/** E2E-UAT-{yyyyMMddHHmmss}-{4hex} */
export function createRunId(now = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const hex = randomBytes(2).toString("hex");
  return `E2E-UAT-${y}${mo}${d}${h}${mi}${s}-${hex}`;
}

export function resolveRunId(preferred?: string | null): string {
  const fromArg = String(preferred ?? "").trim();
  if (fromArg) return fromArg;
  const fromEnv = String(process.env[RUN_ID_ENV] ?? "").trim();
  if (fromEnv) return fromEnv;
  return createRunId();
}

export function runKey(runId: string, suffix: string): string {
  return `${runId}/${suffix}`;
}

export function runInvoiceNo(runId: string, suffix: string): string {
  return `${runId}-${suffix}`.replace(/\//g, "-").slice(0, 64);
}

export function runStorageKey(runId: string, kind: string, name: string): string {
  return `${runId}/${kind}/${name}`;
}

export function assertValidRunId(runId: string): void {
  if (!/^E2E-UAT-\d{14}-[0-9a-f]{4}$/i.test(runId)) {
    throw new Error(
      `STOP: invalid runId "${runId}". Expected E2E-UAT-{yyyyMMddHHmmss}-{4hex}`,
    );
  }
  if (runId.startsWith("UAT-DEMO-PHASES-1-7")) {
    throw new Error("STOP: refusing demo prefix as runId");
  }
}

export function writeManifest(manifest: UatRunManifest): void {
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.mkdirSync(path.dirname(LAST_RUN_JSON_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(WEB_MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(LAST_RUN_JSON_PATH, json, "utf8");
  fs.writeFileSync(WEB_MANIFEST_PATH, json, "utf8");
}

export function readManifest(runIdHint?: string | null): UatRunManifest {
  const hint = String(runIdHint ?? process.env[RUN_ID_ENV] ?? "").trim();
  const candidates = [LAST_RUN_JSON_PATH, WEB_MANIFEST_PATH];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as UatRunManifest;
    if (!parsed?.runId) continue;
    if (hint && parsed.runId !== hint) continue;
    return parsed;
  }
  if (hint) {
    return {
      runId: hint,
      operatingDate: "",
      tenantId: "",
      tenantSlug: tenantSlug(),
      customerCompanyId: "",
      customerCompanyCreated: false,
      jobIds: {},
      tripIds: {},
      expenseIds: {},
      invoiceNos: [],
      driverUserIds: { A: "", B: "" },
      driverIds: { A: "", B: "" },
      psaPrevious: {
        A: {
          driverId: "",
          userId: "",
          email: null,
          previousHasPsaPortAccess: false,
          appliedHasPsaPortAccess: true,
        },
        B: {
          driverId: "",
          userId: "",
          email: null,
          previousHasPsaPortAccess: false,
          appliedHasPsaPortAccess: false,
        },
      },
      scenarios: {},
      createdAt: "",
    };
  }
  throw new Error(
    `STOP: no manifest found and ${RUN_ID_ENV} unset. Run setup first or set ${RUN_ID_ENV}.`,
  );
}

export function redactManifestSummary(manifest: UatRunManifest): Record<string, unknown> {
  return {
    runId: manifest.runId,
    operatingDate: manifest.operatingDate,
    tenantId: redactId(manifest.tenantId),
    tenantSlug: manifest.tenantSlug,
    customerCompanyId: redactId(manifest.customerCompanyId),
    customerCompanyCreated: manifest.customerCompanyCreated,
    jobCount: Object.keys(manifest.jobIds).length,
    tripCount: Object.keys(manifest.tripIds).length,
    expenseCount: Object.keys(manifest.expenseIds).length,
    invoiceCount: manifest.invoiceNos.length,
    driverUserIds: {
      A: redactId(manifest.driverUserIds.A),
      B: redactId(manifest.driverUserIds.B),
    },
    psaPrevious: {
      A: {
        driverId: redactId(manifest.psaPrevious.A.driverId),
        email: redactEmail(manifest.psaPrevious.A.email),
        previous: manifest.psaPrevious.A.previousHasPsaPortAccess,
        applied: manifest.psaPrevious.A.appliedHasPsaPortAccess,
      },
      B: {
        driverId: redactId(manifest.psaPrevious.B.driverId),
        email: redactEmail(manifest.psaPrevious.B.email),
        previous: manifest.psaPrevious.B.previousHasPsaPortAccess,
        applied: manifest.psaPrevious.B.appliedHasPsaPortAccess,
      },
    },
    scenarios: Object.keys(manifest.scenarios),
    paths: {
      lastRun: "scripts/.e2e-uat-last-run.json",
      webManifest: "opsflow-erp-web-v2/e2e/.auth/uat-run-manifest.json",
    },
  };
}
