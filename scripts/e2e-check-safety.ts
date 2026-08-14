import { loadE2eUatEnv } from "./e2e-load-env";
import {
  assertConfirmedUatDatabase,
  assertE2eSafety,
  e2eSafetyEnvForScripts,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();
const result = assertE2eSafety({
  env: e2eSafetyEnvForScripts(),
  webOrigin: process.env.E2E_WEB_ORIGIN,
  apiBaseUrl: process.env.E2E_API_BASE_URL,
  runtimeTenantSlug: process.env.E2E_ALLOWED_TENANT_SLUG,
});
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      tenantSlug: result.tenantSlug,
      webOrigins: result.webOrigins,
      apiBaseUrls: result.apiBaseUrls,
      uatDatabase: true,
      nodeEnvOverridden: "test",
    },
    null,
    2,
  ),
);
