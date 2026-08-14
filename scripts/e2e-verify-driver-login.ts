/** Verify E2E driver credentials against UAT auth. Does not print secrets. */
import { loadE2eUatEnv } from "./e2e-load-env";
import { assertConfirmedUatDatabase } from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

async function login(label: string, email: string, password: string) {
  const api = process.env.E2E_API_BASE_URL;
  const res = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as {
    user?: { role?: string; tenantMemberships?: Array<{ role?: string; status?: string }> };
    tenantMemberships?: Array<{ role?: string; status?: string }>;
  };
  const mems = body.tenantMemberships ?? body.user?.tenantMemberships ?? [];
  return {
    driver: label,
    http: res.status,
    role: mems[0]?.role ?? body.user?.role ?? null,
    membershipStatus: mems[0]?.status ?? null,
  };
}

async function main() {
  const results = [
    await login("A", process.env.E2E_DRIVER_A_EMAIL ?? "", process.env.E2E_DRIVER_A_PASSWORD ?? ""),
    await login("B", process.env.E2E_DRIVER_B_EMAIL ?? "", process.env.E2E_DRIVER_B_PASSWORD ?? ""),
  ];
  console.log(JSON.stringify(results, null, 2));
  if (results.some((row) => row.http >= 400)) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
