/**
 * UAT idempotency concurrency smoke (synthetic data only).
 * Loads backend .env + web e2e/.env.local; never backend .env.local.
 */
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const WEB_E2E_ENV = path.resolve(BACKEND_ROOT, "../opsflow-erp-web-v2/e2e/.env.local");

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

function loadEnv() {
  const uat = parseEnvFile(path.join(BACKEND_ROOT, ".env"));
  const e2e = parseEnvFile(WEB_E2E_ENV);
  for (const [k, v] of Object.entries(uat)) {
    if (!process.env[k]) process.env[k] = v;
  }
  for (const [k, v] of Object.entries(e2e)) process.env[k] = v;
}

async function login() {
  const base = process.env.E2E_API_BASE_URL;
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.E2E_TRANSPORT_EMAIL,
      password: process.env.E2E_TRANSPORT_PASSWORD,
      clientApp: "web",
      tenantSlug: process.env.E2E_ALLOWED_TENANT_SLUG || "e2e-uat",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`login failed ${response.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  const token = body.accessToken || body.token || body.access_token;
  const memberships = body.user?.tenantMemberships ?? body.tenantMemberships;
  const tenantId = memberships?.[0]?.tenantId;
  if (!token || !tenantId) throw new Error(`login missing token or tenantId: ${text.slice(0, 300)}`);
  return { token, tenantId, base };
}

async function api(base, token, tenantId, method, apiPath, body) {
  const response = await fetch(`${base}${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "x-tenant-id": tenantId,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, text };
}

async function main() {
  loadEnv();
  const blob = [process.env.DATABASE_URL, process.env.SUPABASE_PROJECT_URL].join(" ");
  if (blob.includes("qaqmseqfotymmwkmzjsp")) throw new Error("refusing production project");
  if (!blob.includes("rzvayccekcmkpwfyxuzi")) throw new Error("UAT project ref missing");

  const runId = `uat-idem-${Date.now()}`;
  const operationKey = `${runId}:customer`;
  const customerName = `E2E Idempotency Smoke ${runId}`;
  const { token, tenantId, base } = await login();

  const customerPayload = {
    name: customerName,
    commercialStatus: "PROSPECT",
    isActive: true,
    skipDefaultRateTemplate: true,
    onboardingOperationKey: operationKey,
  };

  const [a, b] = await Promise.all([
    api(base, token, tenantId, "POST", "/customers/companies", customerPayload),
    api(base, token, tenantId, "POST", "/customers/companies", customerPayload),
  ]);

  const idA = a.json?.id;
  const idB = b.json?.id;
  const customerIds = new Set([idA, idB].filter(Boolean));

  const conflict = await api(base, token, tenantId, "POST", "/customers/companies", {
    ...customerPayload,
    name: `${customerName} conflicting`,
    onboardingOperationKey: operationKey,
  });

  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUnique({ where: { slug: "e2e-uat" }, select: { id: true } });
  const idemRows = tenant
    ? await prisma.idempotencyRecord.findMany({
        where: { tenantId: tenant.id, operationKey },
      })
    : [];
  const customers = tenant
    ? await prisma.customer_companies.findMany({
        where: { tenantId: tenant.id, name: customerName },
        select: { id: true, name: true },
      })
    : [];

  const customerId = [...customerIds][0];
  let quotationSmoke = null;
  if (customerId) {
    const quotationKey = `${operationKey}:first-quotation`;
    const blankPayload = {
      title: `Smoke quote ${runId}`,
      onboardingQuotationKey: quotationKey,
    };
    const [q1, q2] = await Promise.all([
      api(
        base,
        token,
        tenantId,
        "POST",
        `/customers/companies/${customerId}/customer-quotations`,
        blankPayload,
      ),
      api(
        base,
        token,
        tenantId,
        "POST",
        `/customers/companies/${customerId}/customer-quotations`,
        blankPayload,
      ),
    ]);
    const qIds = new Set([q1.json?.id, q2.json?.id].filter(Boolean));
    const linesKey = `${quotationKey}:lines`;
    const lineConflict = q1.json?.id
      ? await api(
          base,
          token,
          tenantId,
          "PUT",
          `/customers/companies/${customerId}/customer-quotations/${q1.json.id}/lines`,
          {
            lines: [{ code: "SMK_A", label: "Smoke A", unitPriceCents: 1000, qty: 1 }],
            onboardingLinesKey: linesKey,
          },
        )
      : null;
    const lineConflict2 = q1.json?.id
      ? await api(
          base,
          token,
          tenantId,
          "PUT",
          `/customers/companies/${customerId}/customer-quotations/${q1.json.id}/lines`,
          {
            lines: [{ code: "SMK_B", label: "Smoke B", unitPriceCents: 2000, qty: 1 }],
            onboardingLinesKey: linesKey,
          },
        )
      : null;
    quotationSmoke = {
      parallelStatuses: [q1.status, q2.status],
      quotationIds: [...qIds],
      lineFirstStatus: lineConflict?.status,
      lineConflictStatus: lineConflict2?.status,
    };
  }

  await prisma.$disconnect();

  console.log(
    JSON.stringify(
      {
        runId,
        operationKey,
        customerName,
        customerId,
        parallelCustomerStatuses: [a.status, b.status],
        parallelCustomerBodies: [a.json, b.json],
        customerIdsResolved: [...customerIds],
        conflictStatus: conflict.status,
        conflictBody: conflict.json,
        conflictCode: conflict.json?.code,
        customerRowCount: customers.length,
        completedIdempotencyRows: idemRows.filter((r) => r.status === "COMPLETED").length,
        idempotencyResourceId: idemRows.find((r) => r.status === "COMPLETED")?.resourceId ?? null,
        quotationSmoke,
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
