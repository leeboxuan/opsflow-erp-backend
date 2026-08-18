/** Read-only boss-demo / e2e-uat audit. No mutations. */
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

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

const backendRoot = path.resolve(__dirname, "..");
for (const [k, v] of Object.entries(parseEnvFile(path.join(backendRoot, ".env")))) {
  if (!process.env[k]) process.env[k] = v;
}
for (const [k, v] of Object.entries(
  parseEnvFile(path.join(backendRoot, "../opsflow-erp-web-v2/e2e/.env.local")),
)) {
  process.env[k] = v;
}

const blob = [process.env.DATABASE_URL, process.env.SUPABASE_PROJECT_URL].join(" ");
if (!blob.includes("rzvayccekcmkpwfyxuzi")) {
  console.error("Not UAT DB");
  process.exit(1);
}
if (blob.includes("qaqmseqfotymmwkmzjsp")) {
  console.error("Production marker");
  process.exit(1);
}

function isSynthetic(nameOrRef) {
  const s = String(nameOrRef || "");
  return /^(E2E[- ]|BOSS-DEMO|UAT-|WFL-|PW[- ]|PWEX|PWIM|PWLCL)/i.test(s);
}

function sameLocalDay(date, now, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date) === fmt.format(now);
}

async function main() {
  const prisma = new PrismaClient();
  const slug = "e2e-uat";
  const now = new Date("2026-08-17T10:08:00.000Z");

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        timezone: true,
        status: true,
        moduleEntitlements: { select: { module: true, enabled: true } },
      },
    });
    if (!tenant) throw new Error("missing tenant");

    const colJobId = "cmsx23i5t0002crzppkdd6ee5";

    const [customers, drivers, vehicles, jobs, invoices] = await Promise.all([
      prisma.customer_companies.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, name: true, createdAt: true },
        orderBy: { name: "asc" },
      }),
      prisma.drivers.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, name: true, email: true, userId: true },
        orderBy: { name: "asc" },
      }),
      prisma.vehicle.findMany({
        where: { tenantId: tenant.id },
        select: {
          id: true,
          plateNo: true,
          type: true,
          driverId: true,
        },
        orderBy: { plateNo: "asc" },
      }),
      prisma.job.findMany({
        where: { tenantId: tenant.id },
        select: {
          id: true,
          internalRef: true,
          externalRef: true,
          status: true,
          jobType: true,
          customerCompanyId: true,
          pickupDate: true,
          createdAt: true,
          invoiceReadyAt: true,
          customerCompany: { select: { name: true } },
          _count: { select: { trips: true, items: true, charges: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.invoice.findMany({
        where: { tenantId: tenant.id },
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          totalCents: true,
          customerName: true,
          sourceJobId: true,
          issuedAt: true,
          paidAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const colJob = await prisma.job.findUnique({
      where: { id: colJobId },
      select: {
        id: true,
        internalRef: true,
        externalRef: true,
        status: true,
        jobType: true,
        tenantId: true,
        pickupDate: true,
        customerCompany: { select: { id: true, name: true } },
        items: {
          select: { id: true, itemCode: true, sealNo: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
        trips: {
          select: {
            id: true,
            status: true,
            tripSequence: true,
            plannedStartAt: true,
            assignedDriverUserId: true,
            publishedAt: true,
            startedAt: true,
            closedAt: true,
            driverEarningCents: true,
            tripJobItems: {
              select: {
                id: true,
                jobItemId: true,
                containerNumberSnapshot: true,
              },
            },
          },
          orderBy: { tripSequence: "asc" },
        },
      },
    });

    const tripStats = await prisma.trip.groupBy({
      by: ["status"],
      where: { tenantId: tenant.id },
      _count: true,
    });

    const augRange = {
      gte: new Date("2026-08-01T00:00:00+08:00"),
      lt: new Date("2026-09-01T00:00:00+08:00"),
    };
    const julRange = {
      gte: new Date("2026-07-01T00:00:00+08:00"),
      lt: new Date("2026-08-01T00:00:00+08:00"),
    };

    const [completedAug, completedJul, movementsAug, movementsJul] = await Promise.all([
      prisma.trip.count({
        where: {
          tenantId: tenant.id,
          status: { in: ["COMPLETED", "DONE"] },
          closedAt: augRange,
        },
      }),
      prisma.trip.count({
        where: {
          tenantId: tenant.id,
          status: { in: ["COMPLETED", "DONE"] },
          closedAt: julRange,
        },
      }),
      prisma.tripJobItem.count({
        where: {
          trip: {
            tenantId: tenant.id,
            status: { in: ["COMPLETED", "DONE"] },
            closedAt: augRange,
          },
        },
      }),
      prisma.tripJobItem.count({
        where: {
          trip: {
            tenantId: tenant.id,
            status: { in: ["COMPLETED", "DONE"] },
            closedAt: julRange,
          },
        },
      }),
    ]);

    const syntheticJobs = jobs.filter(
      (j) =>
        isSynthetic(j.internalRef) ||
        isSynthetic(j.externalRef) ||
        isSynthetic(j.customerCompany?.name),
    );
    const manualJobs = jobs.filter((j) => !syntheticJobs.includes(j));

    const tz = tenant.timezone || "Asia/Singapore";

    console.log(
      JSON.stringify(
        {
          auditAt: now.toISOString(),
          tenant,
          counts: {
            customers: customers.length,
            drivers: drivers.length,
            vehicles: vehicles.length,
            jobs: jobs.length,
            invoices: invoices.length,
          },
          tripStats,
          completedTrips: { aug2026: completedAug, jul2026: completedJul },
          containerMovements: { aug2026: movementsAug, jul2026: movementsJul },
          customers: customers.map((c) => ({
            id: c.id,
            name: c.name,
            synthetic: isSynthetic(c.name),
          })),
          drivers: drivers.map((d) => ({
            id: d.id,
            name: d.name,
            synthetic: isSynthetic(d.name),
          })),
          vehicles: vehicles.map((v) => ({
            id: v.id,
            plateNo: v.plateNo,
            synthetic: isSynthetic(v.plateNo),
          })),
          syntheticJobs: syntheticJobs.map((j) => ({
            id: j.id,
            internalRef: j.internalRef,
            externalRef: j.externalRef,
            status: j.status,
            jobType: j.jobType,
            customer: j.customerCompany?.name,
            trips: j._count.trips,
            items: j._count.items,
            charges: j._count.charges,
            pickupDate: j.pickupDate,
            invoiceReadyAt: j.invoiceReadyAt,
          })),
          manualJobCount: manualJobs.length,
          manualJobsSample: manualJobs.slice(0, 8).map((j) => ({
            id: j.id,
            internalRef: j.internalRef,
            externalRef: j.externalRef,
            status: j.status,
            jobType: j.jobType,
            customer: j.customerCompany?.name,
          })),
          invoices: invoices.map((i) => ({
            id: i.id,
            number: i.invoiceNo,
            status: i.status,
            totalCents: i.totalCents,
            customer: i.customerName,
            sourceJobId: i.sourceJobId,
            issuedAt: i.issuedAt,
            paidAt: i.paidAt,
          })),
          collectionSmoke: colJob
            ? {
                belongsToTenant: colJob.tenantId === tenant.id,
                id: colJob.id,
                internalRef: colJob.internalRef,
                externalRef: colJob.externalRef,
                status: colJob.status,
                jobType: colJob.jobType,
                pickupDate: colJob.pickupDate,
                customer: colJob.customerCompany,
                items: colJob.items,
                trips: colJob.trips.map((t) => ({
                  ...t,
                  driverStartGate: t.plannedStartAt
                    ? {
                        plannedLocalDay: new Intl.DateTimeFormat("en-CA", {
                          timeZone: tz,
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        }).format(t.plannedStartAt),
                        todayLocalDay: new Intl.DateTimeFormat("en-CA", {
                          timeZone: tz,
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        }).format(now),
                        startAllowedToday: sameLocalDay(t.plannedStartAt, now, tz),
                      }
                    : { startAllowedToday: null, note: "no plannedStartAt" },
                })),
              }
            : null,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
