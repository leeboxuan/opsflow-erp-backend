/**
 * UAT-only: mark historical migrations applied when the schema was db-pushed.
 * Leaves additive Aug 13/14 provenance migrations to run for real.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadE2eUatEnv } from "./e2e-load-env";
import { assertConfirmedUatDatabase } from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

const MUST_RUN = new Set([
  "20260813233000_job_customer_quotation_provenance",
  "20260814001500_invoice_integrity_provenance",
]);

const dirs = fs
  .readdirSync(path.join(__dirname, "../prisma/migrations"))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

for (const name of dirs) {
  if (MUST_RUN.has(name)) continue;
  const result = spawnSync(
    "pnpm",
    ["exec", "prisma", "migrate", "resolve", "--applied", name],
    { stdio: "inherit", shell: true, env: process.env, cwd: path.join(__dirname, "..") },
  );
  if (result.status !== 0) {
    console.warn(`[skip-or-fail] ${name} exit=${result.status}`);
  }
}
console.log("Baseline migrations marked. Run prisma migrate deploy next.");
