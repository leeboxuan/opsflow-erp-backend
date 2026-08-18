/**
 * UAT Job Charge GET smoke (read-only). Uses e2e-uat transport persona.
 */
const fs = require("node:fs");
const path = require("node:path");

const WEB_ROOT = path.resolve(__dirname, "../../opsflow-erp-web-v2");
const RUN_STATE = path.join(WEB_ROOT, "e2e/.auth/run-state.json");

function parseEnvFile(file) {
  const map = {};
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

async function login(api, payload) {
  const res = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`login ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  const token = body.accessToken || body.token || body.access_token;
  const memberships = body.user?.tenantMemberships ?? body.tenantMemberships ?? [];
  return { token, tenantId: memberships[0]?.tenantId };
}

async function get(api, token, tenantId, apiPath) {
  const res = await fetch(`${api}${apiPath}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-tenant-id": tenantId,
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

function summarizeOptions(body) {
  return {
    hasAcceptedQuotationsArray: Array.isArray(body.acceptedQuotations),
    acceptedQuotationsCount: Array.isArray(body.acceptedQuotations)
      ? body.acceptedQuotations.length
      : null,
    legacyTemplatePresent: body.legacyTemplate != null,
    quotationSource: body.quotationSource ?? null,
    boundQuotationId: body.boundQuotation?.id ?? null,
    dhcCount: Array.isArray(body.dhcReferences) ? body.dhcReferences.length : null,
    quotationLineCount: Array.isArray(body.quotationLines) ? body.quotationLines.length : null,
    acceptedQuotationRefs: Array.isArray(body.acceptedQuotations)
      ? body.acceptedQuotations.map((q) => ({
          id: q.id,
          quotationNo: q.quotationNo,
          pickerGroup: q.pickerGroup,
          lineCount: Array.isArray(q.lines) ? q.lines.length : null,
        }))
      : undefined,
  };
}

async function main() {
  const e2e = parseEnvFile(path.join(WEB_ROOT, "e2e/.env.local"));
  const api = (e2e.E2E_API_BASE_URL || "").replace(/\/+$/, "");
  if (!api.includes("api-uat.opsflowtechnologies.com")) {
    throw new Error("Refusing non-UAT API");
  }

  const { token, tenantId } = await login(api, {
    email: e2e.E2E_TRANSPORT_EMAIL,
    password: e2e.E2E_TRANSPORT_PASSWORD,
    clientApp: "web",
    tenantSlug: e2e.E2E_ALLOWED_TENANT_SLUG || "e2e-uat",
  });

  const runState = fs.existsSync(RUN_STATE)
    ? JSON.parse(fs.readFileSync(RUN_STATE, "utf8"))
    : {};
  const jobIds = [runState.jobId].filter(Boolean);

  const jobsList = await get(api, token, tenantId, "/jobs?page=1&pageSize=20");
  const jobs = Array.isArray(jobsList.json?.data) ? jobsList.json.data : [];

  const results = {};
  for (const jobId of jobIds) {
    const options = await get(api, token, tenantId, `/jobs/${jobId}/billing-charge-options`);
    results[jobId] = {
      status: options.status,
      ...summarizeOptions(options.json ?? {}),
    };
  }

  console.log(
    JSON.stringify(
      {
        tenantSlug: e2e.E2E_ALLOWED_TENANT_SLUG || "e2e-uat",
        tenantId,
        jobsSampleCount: jobs.length,
        deployContractReady: Object.values(results).some(
          (row) => row.hasAcceptedQuotationsArray,
        ),
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
