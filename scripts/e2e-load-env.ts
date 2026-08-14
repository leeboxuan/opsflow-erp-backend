/**
 * Load E2E + UAT env for mutation scripts.
 * Never loads backend `.env.local` (production).
 */
import fs from "node:fs";
import path from "node:path";

const BACKEND_ROOT = path.resolve(__dirname, "..");
const WEB_E2E_ENV = path.resolve(BACKEND_ROOT, "../opsflow-erp-web-v2/e2e/.env.local");
const UAT_ENV = path.join(BACKEND_ROOT, ".env");
const FORBIDDEN_ENV = path.join(BACKEND_ROOT, ".env.local");

function parseEnvFile(file: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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
    map[trimmed.slice(0, i).trim()] = value;
  }
  return map;
}

export function loadE2eUatEnv(): void {
  if (fs.existsSync(FORBIDDEN_ENV)) {
    // Presence is expected on this machine; never apply it.
  }
  const uat = parseEnvFile(UAT_ENV);
  const e2e = parseEnvFile(WEB_E2E_ENV);
  for (const [key, value] of Object.entries(uat)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(e2e)) {
    process.env[key] = value;
  }
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = process.env.APP_ENV || "uat";
  process.env.OPSFLOW_ENV = process.env.OPSFLOW_ENV || "uat";
}
