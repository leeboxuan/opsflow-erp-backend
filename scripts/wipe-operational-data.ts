/**
 * Wipe OpsFlow operational (job/trip) test data while preserving users, tenants,
 * companies, drivers, vehicles, chassis, master/config, and warehouse-domain data.
 *
 * Usage (tenant-scoped — preferred):
 *   TENANT_ID=<cuid> CONFIRM_WIPE_ENV=<dbName> npm run wipe:ops-data -- --dry-run
 *   ALLOW_DATA_WIPE=true TENANT_ID=<cuid> CONFIRM_WIPE_ENV=<dbName> npm run wipe:ops-data
 *
 * All-tenant wipe (explicit opt-in only — never inferred from missing TENANT_ID):
 *   ALLOW_DATA_WIPE=true WIPE_ALL_TENANTS=true CONFIRM_WIPE_ENV=<dbName> \
 *     npm run wipe:ops-data -- --all-tenants
 *
 * Production (extra gate):
 *   ALLOW_DATA_WIPE=true ALLOW_PRODUCTION_WIPE=true TENANT_ID=<cuid> CONFIRM_WIPE_ENV=<dbName> \
 *     npm run wipe:ops-data -- --confirm-production
 *
 * Safety:
 *   --dry-run                 Counts only; no DB or storage deletes
 *   TENANT_ID                 Required for tenant-scoped wipe (exact tenant cuid)
 *   --all-tenants             Required with WIPE_ALL_TENANTS=true for all-tenant wipe
 *   WIPE_ALL_TENANTS=true     Required with --all-tenants (fail-closed otherwise)
 *   ALLOW_DATA_WIPE=true      Required for actual deletes (unless --dry-run)
 *   CONFIRM_WIPE_ENV          Must equal the target database name (required always)
 *   --confirm-production      Required when target looks like production
 *   ALLOW_PRODUCTION_WIPE=true  Required with --confirm-production
 *
 * Does NOT delete Supabase auth users.
 * Does NOT wipe warehouse domain or master/reference data.
 *
 * TripJobItem: if `trip_job_items` table is missing (migration not applied yet),
 * that step is skipped and reported — wipe remains safe either before or after migrate.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import {
  parseWipeScopeArgs,
  resolveWipeScope,
} from "../src/scripts/wipe-operational-scope";

/** Job/trip docs, invoice PDFs, generated company docs — see job-document-signed-url.ts */
const JOB_DOCUMENTS_BUCKET = "job-documents";
/** POD stop photos — see src/transport/pod.service.ts (POD_BUCKET) */
const POD_PHOTOS_BUCKET = "pods-photos";

const JOB_TRIP_ENTITY_TYPES = ["JOB", "TRIP"] as const;

type StorageDeletionPlan = {
  jobDocumentKeys: string[];
  podPhotoKeys: string[];
};

type TenantFilter = { tenantId: string } | Record<string, never>;

type DatabaseIdentity = {
  host: string;
  port: string;
  database: string;
  user: string;
  rawUrlPresent: boolean;
};

type OperationalCounts = {
  tripJobItems: number | "TABLE_MISSING";
  jobs: number;
  trips: number;
  jobItems: number;
  jobDocuments: number;
  tripDocuments: number;
  jobCharges: number;
  tripPayoutLines: number;
  tripDocumentRequirements: number;
  invoices: number;
  invoiceLineItems: number;
  notifications: number;
  notificationRecipients: number;
  auditLogs: number;
  eventLogs: number;
  driverWalletTransactions: number;
  driverWalletEntries: number;
  customerCompanyDocuments: number;
  jobInternalRefCounters: number;
  podPhotoDocuments: number;
  storageObjectsJobDocuments: number;
  storageObjectsPodPhotos: number;
};

type PreservedCounts = {
  users: number;
  tenants: number;
  tenantMemberships: number;
  customerCompanies: number;
  drivers: number;
  vehicles: number;
  fleetVehicles: number;
  chassis: number;
  masterLogisticsLocations: number;
  masterFiles: number;
  masterTrailerLocations: number;
  driverTripRateMasters: number;
  depotHandlingReferences: number;
  warehouseJobs: number;
};

type DeletionCounts = Record<string, number | "SKIPPED_TABLE_MISSING">;

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  confirmProduction: boolean;
  allTenants: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const scope = parseWipeScopeArgs(argv);
  const opts: CliOptions = {
    dryRun: false,
    help: false,
    confirmProduction: false,
    allTenants: scope.allTenants,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    if (arg === "--dry-run") opts.dryRun = true;
    if (arg === "--confirm-production") opts.confirmProduction = true;
  }
  return opts;
}

function printHelp(): void {
  console.log(`
Wipe operational job/trip test data (preserves users, tenants, master data, warehouse).

Tenant-scoped (required unless --all-tenants):
  TENANT_ID=<id> CONFIRM_WIPE_ENV=<dbName> npm run wipe:ops-data -- --dry-run
  ALLOW_DATA_WIPE=true TENANT_ID=<id> CONFIRM_WIPE_ENV=<dbName> npm run wipe:ops-data

All-tenant (explicit opt-in — NEVER the default):
  ALLOW_DATA_WIPE=true WIPE_ALL_TENANTS=true CONFIRM_WIPE_ENV=<dbName> \\
    npm run wipe:ops-data -- --all-tenants --dry-run
  ALLOW_DATA_WIPE=true WIPE_ALL_TENANTS=true CONFIRM_WIPE_ENV=<dbName> \\
    npm run wipe:ops-data -- --all-tenants

Production (extra gate, still requires TENANT_ID or --all-tenants):
  ALLOW_DATA_WIPE=true ALLOW_PRODUCTION_WIPE=true TENANT_ID=<id> CONFIRM_WIPE_ENV=<dbName> \\
    npm run wipe:ops-data -- --confirm-production

Environment:
  TENANT_ID              Exact tenant cuid for tenant-scoped wipe (required unless --all-tenants)
  WIPE_ALL_TENANTS       Must be "true" together with --all-tenants
  CONFIRM_WIPE_ENV       Must equal the target database name (printed on start)
  ALLOW_DATA_WIPE        Must be "true" for actual deletes
  ALLOW_PRODUCTION_WIPE  Must be "true" with --confirm-production for production
  DATABASE_URL           Prisma connection (via .env.local)
  SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY  For storage cleanup

Flags:
  --dry-run              Count only; no deletes (same scope rules apply)
  --all-tenants          Explicit all-tenant wipe (requires WIPE_ALL_TENANTS=true)
  --confirm-production   Explicit production wipe confirmation
  --help                 Show this help

Rejects:
  - neither TENANT_ID nor --all-tenants
  - both TENANT_ID and --all-tenants
  - --all-tenants without WIPE_ALL_TENANTS=true
  - WIPE_ALL_TENANTS=true without --all-tenants

Deletes (transport operational / job-linked financial):
  trip_job_items, trip documents/requirements/payouts, trips, job items/docs/charges,
  job-linked invoices + line items, job/trip notifications, related audit/event/wallet rows,
  job-sourced company docs, job internal ref counters, POD photos for wiped trips

Preserves:
  tenants, users/memberships, customers, drivers, vehicles/fleet, chassis,
  master rates/locations/files, warehouse domain, system config

Storage buckets cleaned:
  job-documents  Job/trip documents, invoice PDFs, job-sourced company docs
  pods-photos    pod_photo_documents.photoKey for stops on trips in scope
`);
}

function parseDatabaseIdentity(databaseUrl: string | undefined): DatabaseIdentity {
  if (!databaseUrl?.trim()) {
    return {
      host: "(unset)",
      port: "(unset)",
      database: "(unset)",
      user: "(unset)",
      rawUrlPresent: false,
    };
  }
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, "http:").replace(/^postgres:/i, "http:");
    const u = new URL(normalized);
    return {
      host: u.hostname || "(unknown)",
      port: u.port || "5432",
      database: (u.pathname || "/").replace(/^\//, "") || "(unknown)",
      user: decodeURIComponent(u.username || "(unknown)"),
      rawUrlPresent: true,
    };
  } catch {
    return {
      host: "(unparseable)",
      port: "(unparseable)",
      database: "(unparseable)",
      user: "(unparseable)",
      rawUrlPresent: true,
    };
  }
}

function printDatabaseIdentity(identity: DatabaseIdentity): void {
  console.log("\n=== TARGET DATABASE (no credentials) ===");
  console.log(`  host:     ${identity.host}`);
  console.log(`  port:     ${identity.port}`);
  console.log(`  database: ${identity.database}`);
  console.log(`  user:     ${identity.user}`);
  console.log(
    `  CONFIRM_WIPE_ENV must equal database name: "${identity.database}"`,
  );
}

function looksLikeProduction(identity: DatabaseIdentity): boolean {
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  const appEnv = String(
    process.env.APP_ENV ?? process.env.OPSFLOW_ENV ?? process.env.ENVIRONMENT ?? "",
  )
    .trim()
    .toLowerCase();
  if (nodeEnv === "production" || appEnv === "production" || appEnv === "prod") {
    return true;
  }
  const db = identity.database.toLowerCase();
  const host = identity.host.toLowerCase();
  if (/\bprod\b/.test(db) || db.includes("production")) return true;
  if (/\bprod\b/.test(host) || host.includes("production")) return true;
  return false;
}

function assertWipeSafety(
  opts: CliOptions,
  identity: DatabaseIdentity,
): void {
  if (!identity.rawUrlPresent) {
    console.error("Refusing: DATABASE_URL is not set.");
    process.exit(1);
  }
  if (identity.database === "(unparseable)" || identity.database === "(unknown)") {
    console.error(
      "Refusing: could not parse database name from DATABASE_URL for confirmation.",
    );
    process.exit(1);
  }

  const confirmEnv = String(process.env.CONFIRM_WIPE_ENV ?? "").trim();
  if (!confirmEnv) {
    console.error(
      `Refusing: set CONFIRM_WIPE_ENV=${identity.database} to confirm the target database.`,
    );
    process.exit(1);
  }
  if (confirmEnv !== identity.database) {
    console.error(
      `Refusing: CONFIRM_WIPE_ENV="${confirmEnv}" does not match database "${identity.database}".`,
    );
    process.exit(1);
  }

  const isProd = looksLikeProduction(identity);
  if (isProd) {
    const allowProd = process.env.ALLOW_PRODUCTION_WIPE === "true";
    if (!opts.confirmProduction || !allowProd) {
      console.error(
        "Refusing production wipe. Production-like target detected.\n" +
          "  Set ALLOW_PRODUCTION_WIPE=true and pass --confirm-production\n" +
          "  (in addition to ALLOW_DATA_WIPE=true and CONFIRM_WIPE_ENV).",
      );
      process.exit(1);
    }
    console.warn("WARNING: production wipe confirmation accepted.");
  } else if (opts.confirmProduction) {
    console.log(
      "Note: --confirm-production set but target does not look like production; continuing.",
    );
  }

  if (!opts.dryRun && process.env.ALLOW_DATA_WIPE !== "true") {
    console.error(
      "Refusing to delete data. Set ALLOW_DATA_WIPE=true or pass --dry-run.",
    );
    process.exit(1);
  }
}

function podPhotoDocumentWhere(
  filter: TenantFilter,
  tripIds: string[],
): Prisma.PodPhotoDocumentWhereInput {
  return {
    ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
    stop: tripIds.length ? { tripId: { in: tripIds } } : { tripId: { in: [] } },
  };
}

function tenantWhere(filter: TenantFilter): Prisma.JobWhereInput {
  return "tenantId" in filter ? { tenantId: filter.tenantId } : {};
}

function tripWhere(filter: TenantFilter): Prisma.TripWhereInput {
  return "tenantId" in filter ? { tenantId: filter.tenantId } : {};
}

async function tripJobItemTableExists(prisma: PrismaClient): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.trip_job_items')::text AS reg
    `;
    return Boolean(rows[0]?.reg);
  } catch {
    return false;
  }
}

async function collectJobIds(
  prisma: PrismaClient,
  filter: TenantFilter,
): Promise<string[]> {
  const rows = await prisma.job.findMany({
    where: tenantWhere(filter),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function collectTripIds(
  prisma: PrismaClient,
  filter: TenantFilter,
): Promise<string[]> {
  const rows = await prisma.trip.findMany({
    where: tripWhere(filter),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function notificationWhere(
  prisma: PrismaClient,
  filter: TenantFilter,
  jobIds: string[],
  tripIds: string[],
): Promise<Prisma.NotificationWhereInput> {
  const tenantClause =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  return {
    ...tenantClause,
    OR: [
      { jobId: { not: null } },
      { tripId: { not: null } },
      { entityType: { in: [...JOB_TRIP_ENTITY_TYPES] } },
      ...(jobIds.length ? [{ jobId: { in: jobIds } }] : []),
      ...(tripIds.length ? [{ tripId: { in: tripIds } }] : []),
    ],
  };
}

async function countOperational(
  prisma: PrismaClient,
  filter: TenantFilter,
  hasTripJobItemTable: boolean,
): Promise<OperationalCounts> {
  const jobIds = await collectJobIds(prisma, filter);
  const tripIds = await collectTripIds(prisma, filter);
  const notifWhere = await notificationWhere(prisma, filter, jobIds, tripIds);

  const invoiceWhere: Prisma.InvoiceWhereInput = {
    ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
    sourceJobId: { not: null },
  };

  const invoiceIds = (
    await prisma.invoice.findMany({
      where: invoiceWhere,
      select: { id: true },
    })
  ).map((r) => r.id);

  const auditWhere: Prisma.AuditLogWhereInput = {
    ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
    OR: [
      { entityType: { in: [...JOB_TRIP_ENTITY_TYPES] } },
      ...(jobIds.length ? [{ entityId: { in: jobIds } }] : []),
      ...(tripIds.length ? [{ entityId: { in: tripIds } }] : []),
    ],
  };

  const eventWhere: Prisma.EventLogWhereInput = {
    ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
    OR: [
      { entityType: { in: [...JOB_TRIP_ENTITY_TYPES] } },
      ...(jobIds.length ? [{ entityId: { in: jobIds } }] : []),
      ...(tripIds.length ? [{ entityId: { in: tripIds } }] : []),
    ],
  };

  const walletEntryWhere: Prisma.driver_wallet_entriesWhereInput = {
    ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
    OR: [
      ...(jobIds.length
        ? [{ sourceType: "JOB", sourceId: { in: jobIds } }]
        : []),
      ...(tripIds.length
        ? [{ sourceType: "TRIP", sourceId: { in: tripIds } }]
        : []),
    ],
  };

  const tripJobItemCountPromise: Promise<number | "TABLE_MISSING"> =
    hasTripJobItemTable
      ? prisma.tripJobItem.count({
          where: {
            ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
            ...(tripIds.length
              ? { tripId: { in: tripIds } }
              : { tripId: { in: [] } }),
          },
        })
      : Promise.resolve("TABLE_MISSING");

  const [
    tripJobItems,
    jobs,
    trips,
    jobItems,
    jobDocuments,
    tripDocuments,
    jobCharges,
    tripPayoutLines,
    tripDocumentRequirements,
    invoices,
    invoiceLineItems,
    notifications,
    notificationRecipients,
    auditLogs,
    eventLogs,
    driverWalletTransactions,
    driverWalletEntries,
    customerCompanyDocuments,
    jobInternalRefCounters,
    podPhotoDocuments,
  ] = await Promise.all([
    tripJobItemCountPromise,
    prisma.job.count({ where: tenantWhere(filter) }),
    prisma.trip.count({ where: tripWhere(filter) }),
    prisma.jobItem.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        ...(jobIds.length ? { jobId: { in: jobIds } } : { jobId: { in: [] } }),
      },
    }),
    prisma.jobDocument.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        ...(jobIds.length ? { jobId: { in: jobIds } } : { jobId: { in: [] } }),
      },
    }),
    prisma.tripDocument.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        ...(tripIds.length ? { tripId: { in: tripIds } } : { tripId: { in: [] } }),
      },
    }),
    prisma.jobCharge.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        ...(jobIds.length ? { jobId: { in: jobIds } } : { jobId: { in: [] } }),
      },
    }),
    prisma.tripPayoutLine.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        ...(tripIds.length ? { tripId: { in: tripIds } } : { tripId: { in: [] } }),
      },
    }),
    prisma.tripDocumentRequirement.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        ...(tripIds.length ? { tripId: { in: tripIds } } : { tripId: { in: [] } }),
      },
    }),
    prisma.invoice.count({ where: invoiceWhere }),
    prisma.invoiceLineItem.count({
      where: {
        OR: [
          ...(invoiceIds.length ? [{ invoiceId: { in: invoiceIds } }] : []),
          ...(tripIds.length ? [{ sourceTripId: { in: tripIds } }] : []),
        ],
      },
    }),
    prisma.notification.count({ where: notifWhere }),
    prisma.notificationRecipient.count({
      where: { notification: notifWhere },
    }),
    prisma.auditLog.count({ where: auditWhere }),
    prisma.eventLog.count({ where: eventWhere }),
    prisma.driverWalletTransaction.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        ...(tripIds.length ? { tripId: { in: tripIds } } : { tripId: { in: [] } }),
      },
    }),
    walletEntryWhere.OR?.length
      ? prisma.driver_wallet_entries.count({ where: walletEntryWhere })
      : Promise.resolve(0),
    prisma.customerCompanyDocument.count({
      where: {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        OR: [
          ...(jobIds.length ? [{ sourceJobId: { in: jobIds } }] : []),
          ...(invoiceIds.length ? [{ sourceInvoiceId: { in: invoiceIds } }] : []),
        ],
      },
    }),
    prisma.job_internal_ref_counters.count({
      where: "tenantId" in filter ? { tenantId: filter.tenantId } : {},
    }),
    prisma.podPhotoDocument.count({
      where: podPhotoDocumentWhere(filter, tripIds),
    }),
  ]);

  const [jobDocKeys, tripDocKeys, invoicePdfKeys, companyDocKeys, podPhotoRows] =
    await Promise.all([
      prisma.jobDocument.findMany({
        where: {
          ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
          ...(jobIds.length ? { jobId: { in: jobIds } } : { jobId: { in: [] } }),
        },
        select: { storageKey: true },
      }),
      prisma.tripDocument.findMany({
        where: {
          ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
          ...(tripIds.length ? { tripId: { in: tripIds } } : { tripId: { in: [] } }),
        },
        select: { storageKey: true },
      }),
      prisma.invoice.findMany({
        where: invoiceWhere,
        select: { pdfKey: true },
      }),
      prisma.customerCompanyDocument.findMany({
        where: {
          ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
          OR: [
            ...(jobIds.length ? [{ sourceJobId: { in: jobIds } }] : []),
            ...(invoiceIds.length ? [{ sourceInvoiceId: { in: invoiceIds } }] : []),
          ],
        },
        select: { storageKey: true },
      }),
      prisma.podPhotoDocument.findMany({
        where: podPhotoDocumentWhere(filter, tripIds),
        select: { photoKey: true },
      }),
    ]);

  const jobDocumentStorageKeys = new Set<string>();
  for (const row of [...jobDocKeys, ...tripDocKeys, ...companyDocKeys]) {
    if (row.storageKey?.trim()) jobDocumentStorageKeys.add(row.storageKey.trim());
  }
  for (const row of invoicePdfKeys) {
    if (row.pdfKey?.trim()) jobDocumentStorageKeys.add(row.pdfKey.trim());
  }

  const podPhotoStorageKeys = new Set<string>();
  for (const row of podPhotoRows) {
    if (row.photoKey?.trim()) podPhotoStorageKeys.add(row.photoKey.trim());
  }

  return {
    tripJobItems,
    jobs,
    trips,
    jobItems,
    jobDocuments,
    tripDocuments,
    jobCharges,
    tripPayoutLines,
    tripDocumentRequirements,
    invoices,
    invoiceLineItems,
    notifications,
    notificationRecipients,
    auditLogs,
    eventLogs,
    driverWalletTransactions,
    driverWalletEntries,
    customerCompanyDocuments,
    jobInternalRefCounters,
    podPhotoDocuments,
    storageObjectsJobDocuments: jobDocumentStorageKeys.size,
    storageObjectsPodPhotos: podPhotoStorageKeys.size,
  };
}

async function countPreserved(
  prisma: PrismaClient,
  filter: TenantFilter,
): Promise<PreservedCounts> {
  const tenantMembershipWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const customerWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const driverWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const vehicleWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const fleetWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const masterFileWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const rateMasterWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const depotWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const chassisWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};
  const warehouseWhere =
    "tenantId" in filter ? { tenantId: filter.tenantId } : {};

  const [
    users,
    tenants,
    tenantMemberships,
    customerCompanies,
    drivers,
    vehicles,
    fleetVehicles,
    chassis,
    masterLogisticsLocations,
    masterFiles,
    masterTrailerLocations,
    driverTripRateMasters,
    depotHandlingReferences,
    warehouseJobs,
  ] = await Promise.all([
    prisma.user.count(),
    "tenantId" in filter
      ? prisma.tenant.count({ where: { id: filter.tenantId } })
      : prisma.tenant.count(),
    prisma.tenantMembership.count({ where: tenantMembershipWhere }),
    prisma.customer_companies.count({ where: customerWhere }),
    prisma.drivers.count({ where: driverWhere }),
    prisma.vehicle.count({ where: vehicleWhere }),
    prisma.fleetVehicle.count({ where: fleetWhere }),
    prisma.chassis.count({ where: chassisWhere }),
    prisma.masterLogisticsLocation.count(),
    prisma.masterFile.count({ where: masterFileWhere }),
    prisma.masterTrailerLocation.count(),
    prisma.driverTripRateMaster.count({ where: rateMasterWhere }),
    prisma.depotHandlingReference.count({ where: depotWhere }),
    prisma.warehouseJob.count({ where: warehouseWhere }),
  ]);

  return {
    users,
    tenants,
    tenantMemberships,
    customerCompanies,
    drivers,
    vehicles,
    fleetVehicles,
    chassis,
    masterLogisticsLocations,
    masterFiles,
    masterTrailerLocations,
    driverTripRateMasters,
    depotHandlingReferences,
    warehouseJobs,
  };
}

function printCounts(label: string, op: OperationalCounts, preserved: PreservedCounts): void {
  console.log(`\n=== ${label} ===`);
  console.log("Operational (target wipe scope):");
  console.log(`  trip_job_items:            ${op.tripJobItems}`);
  console.log(`  jobs:                      ${op.jobs}`);
  console.log(`  trips:                     ${op.trips}`);
  console.log(`  job_items:                 ${op.jobItems}`);
  console.log(`  job_documents:             ${op.jobDocuments}`);
  console.log(`  trip_documents:            ${op.tripDocuments}`);
  console.log(`  job_charges:               ${op.jobCharges}`);
  console.log(`  trip_payout_lines:         ${op.tripPayoutLines}`);
  console.log(`  trip_document_requirements:${op.tripDocumentRequirements}`);
  console.log(`  invoices (job-linked):     ${op.invoices}`);
  console.log(`  invoice_line_items:        ${op.invoiceLineItems}`);
  console.log(`  notifications (job/trip):  ${op.notifications}`);
  console.log(`  notification_recipients:   ${op.notificationRecipients}`);
  console.log(`  audit_logs (job/trip):     ${op.auditLogs}`);
  console.log(`  event_logs (job/trip):     ${op.eventLogs}`);
  console.log(`  driver_wallet_transactions:${op.driverWalletTransactions}`);
  console.log(`  driver_wallet_entries:     ${op.driverWalletEntries}`);
  console.log(`  customer_company_docs:     ${op.customerCompanyDocuments}`);
  console.log(`  job_internal_ref_counters: ${op.jobInternalRefCounters}`);
  console.log(`  pod_photo_documents:       ${op.podPhotoDocuments}`);
  console.log(
    `  storage_objects (${JOB_DOCUMENTS_BUCKET}): ${op.storageObjectsJobDocuments}`,
  );
  console.log(
    `  storage_objects (${POD_PHOTOS_BUCKET}): ${op.storageObjectsPodPhotos}`,
  );
  console.log("Preserved (should remain):");
  console.log(`  users:                     ${preserved.users}`);
  console.log(`  tenants:                   ${preserved.tenants}`);
  console.log(`  tenant_memberships:        ${preserved.tenantMemberships}`);
  console.log(`  customer_companies:        ${preserved.customerCompanies}`);
  console.log(`  drivers:                   ${preserved.drivers}`);
  console.log(`  vehicles:                  ${preserved.vehicles}`);
  console.log(`  fleet_vehicles:            ${preserved.fleetVehicles}`);
  console.log(`  chassis:                   ${preserved.chassis}`);
  console.log(`  master_logistics_locations:${preserved.masterLogisticsLocations}`);
  console.log(`  master_files:              ${preserved.masterFiles}`);
  console.log(`  master_trailer_locations:  ${preserved.masterTrailerLocations}`);
  console.log(`  driver_trip_rate_masters:  ${preserved.driverTripRateMasters}`);
  console.log(`  depot_handling_references: ${preserved.depotHandlingReferences}`);
  console.log(`  warehouse_jobs:            ${preserved.warehouseJobs}`);
}

function printDeletionCounts(counts: DeletionCounts): void {
  console.log("\n=== DELETION COUNTS BY MODEL ===");
  for (const [model, count] of Object.entries(counts)) {
    console.log(`  ${model}: ${count}`);
  }
}

async function collectStorageDeletionPlan(
  prisma: PrismaClient,
  filter: TenantFilter,
  jobIds: string[],
  tripIds: string[],
  invoiceIds: string[],
): Promise<StorageDeletionPlan> {
  const [jobDocs, tripDocs, invoices, companyDocs, podPhotoRows] =
    await Promise.all([
      prisma.jobDocument.findMany({
        where: {
          ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
          jobId: { in: jobIds },
        },
        select: { storageKey: true },
      }),
      prisma.tripDocument.findMany({
        where: {
          ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
          tripId: { in: tripIds },
        },
        select: { storageKey: true },
      }),
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { pdfKey: true },
      }),
      prisma.customerCompanyDocument.findMany({
        where: {
          ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
          OR: [
            { sourceJobId: { in: jobIds } },
            { sourceInvoiceId: { in: invoiceIds } },
          ],
        },
        select: { storageKey: true },
      }),
      prisma.podPhotoDocument.findMany({
        where: podPhotoDocumentWhere(filter, tripIds),
        select: { photoKey: true },
      }),
    ]);

  const jobDocumentKeys = new Set<string>();
  for (const row of [...jobDocs, ...tripDocs, ...companyDocs]) {
    if (row.storageKey?.trim()) jobDocumentKeys.add(row.storageKey.trim());
  }
  for (const row of invoices) {
    if (row.pdfKey?.trim()) jobDocumentKeys.add(row.pdfKey.trim());
  }

  const podPhotoKeys = new Set<string>();
  for (const row of podPhotoRows) {
    if (row.photoKey?.trim()) podPhotoKeys.add(row.photoKey.trim());
  }

  return {
    jobDocumentKeys: [...jobDocumentKeys],
    podPhotoKeys: [...podPhotoKeys],
  };
}

async function deleteStoragePlan(
  plan: StorageDeletionPlan,
): Promise<{
  deleted: number;
  failed: { bucket: string; keys: string[] }[];
}> {
  const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "Skipping storage deletion: SUPABASE_PROJECT_URL or SUPABASE_SERVICE_ROLE_KEY not set.",
    );
    const failed: { bucket: string; keys: string[] }[] = [];
    if (plan.jobDocumentKeys.length) {
      failed.push({ bucket: JOB_DOCUMENTS_BUCKET, keys: plan.jobDocumentKeys });
    }
    if (plan.podPhotoKeys.length) {
      failed.push({ bucket: POD_PHOTOS_BUCKET, keys: plan.podPhotoKeys });
    }
    return {
      deleted: 0,
      failed,
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const failed: { bucket: string; keys: string[] }[] = [];
  let deleted = 0;
  const batchSize = 50;

  const buckets: { bucket: string; keys: string[] }[] = [
    { bucket: JOB_DOCUMENTS_BUCKET, keys: plan.jobDocumentKeys },
    { bucket: POD_PHOTOS_BUCKET, keys: plan.podPhotoKeys },
  ];

  for (const { bucket, keys } of buckets) {
    if (!keys.length) continue;

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        console.warn(
          `Storage batch delete failed (${bucket}): ${error.message}`,
        );
        failed.push({ bucket, keys: batch });
      } else {
        deleted += batch.length;
      }
    }
  }

  return { deleted, failed };
}

async function wipeOperationalData(
  prisma: PrismaClient,
  filter: TenantFilter,
  hasTripJobItemTable: boolean,
): Promise<{ storagePlan: StorageDeletionPlan; deletionCounts: DeletionCounts }> {
  const jobIds = await collectJobIds(prisma, filter);
  const tripIds = await collectTripIds(prisma, filter);
  const notifWhere = await notificationWhere(prisma, filter, jobIds, tripIds);

  const invoiceWhere: Prisma.InvoiceWhereInput = {
    ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
    sourceJobId: { not: null },
  };
  const invoiceRows = await prisma.invoice.findMany({
    where: invoiceWhere,
    select: { id: true },
  });
  const invoiceIds = invoiceRows.map((r) => r.id);

  const storagePlan = await collectStorageDeletionPlan(
    prisma,
    filter,
    jobIds,
    tripIds,
    invoiceIds,
  );

  const deletionCounts: DeletionCounts = {};

  try {
    await prisma.$transaction(async (tx) => {
      const notifIds = (
        await tx.notification.findMany({
          where: notifWhere,
          select: { id: true },
        })
      ).map((n) => n.id);

      if (notifIds.length) {
        deletionCounts.notificationRecipient = (
          await tx.notificationRecipient.deleteMany({
            where: { notificationId: { in: notifIds } },
          })
        ).count;
        deletionCounts.notification = (
          await tx.notification.deleteMany({ where: { id: { in: notifIds } } })
        ).count;
      } else {
        deletionCounts.notificationRecipient = 0;
        deletionCounts.notification = 0;
      }

      if (invoiceIds.length) {
        deletionCounts.invoiceLineItem_byInvoice = (
          await tx.invoiceLineItem.deleteMany({
            where: { invoiceId: { in: invoiceIds } },
          })
        ).count;
        await tx.transportOrder.updateMany({
          where: { invoiceId: { in: invoiceIds } },
          data: { invoiceId: null },
        });
        deletionCounts.transportOrder_invoiceId_nulled = invoiceIds.length;
      } else {
        deletionCounts.invoiceLineItem_byInvoice = 0;
        deletionCounts.transportOrder_invoiceId_nulled = 0;
      }

      if (tripIds.length) {
        deletionCounts.invoiceLineItem_byTrip = (
          await tx.invoiceLineItem.deleteMany({
            where: { sourceTripId: { in: tripIds } },
          })
        ).count;
      } else {
        deletionCounts.invoiceLineItem_byTrip = 0;
      }

      if (jobIds.length || invoiceIds.length) {
        deletionCounts.customerCompanyDocument = (
          await tx.customerCompanyDocument.deleteMany({
            where: {
              ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
              OR: [
                ...(jobIds.length ? [{ sourceJobId: { in: jobIds } }] : []),
                ...(invoiceIds.length ? [{ sourceInvoiceId: { in: invoiceIds } }] : []),
              ],
            },
          })
        ).count;
      } else {
        deletionCounts.customerCompanyDocument = 0;
      }

      if (invoiceIds.length) {
        deletionCounts.invoice = (
          await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } })
        ).count;
      } else {
        deletionCounts.invoice = 0;
      }

      const auditWhere: Prisma.AuditLogWhereInput = {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        OR: [
          { entityType: { in: [...JOB_TRIP_ENTITY_TYPES] } },
          ...(jobIds.length ? [{ entityId: { in: jobIds } }] : []),
          ...(tripIds.length ? [{ entityId: { in: tripIds } }] : []),
        ],
      };
      deletionCounts.auditLog = (await tx.auditLog.deleteMany({ where: auditWhere })).count;

      const eventWhere: Prisma.EventLogWhereInput = {
        ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
        OR: [
          { entityType: { in: [...JOB_TRIP_ENTITY_TYPES] } },
          ...(jobIds.length ? [{ entityId: { in: jobIds } }] : []),
          ...(tripIds.length ? [{ entityId: { in: tripIds } }] : []),
        ],
      };
      deletionCounts.eventLog = (await tx.eventLog.deleteMany({ where: eventWhere })).count;

      if (hasTripJobItemTable && tripIds.length) {
        deletionCounts.tripJobItem = (
          await tx.tripJobItem.deleteMany({
            where: {
              ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
              tripId: { in: tripIds },
            },
          })
        ).count;
      } else if (!hasTripJobItemTable) {
        deletionCounts.tripJobItem = "SKIPPED_TABLE_MISSING";
      } else {
        deletionCounts.tripJobItem = 0;
      }

      if (tripIds.length) {
        deletionCounts.tripDocumentRequirement = (
          await tx.tripDocumentRequirement.deleteMany({
            where: { tripId: { in: tripIds } },
          })
        ).count;
        deletionCounts.tripPayoutLine = (
          await tx.tripPayoutLine.deleteMany({
            where: { tripId: { in: tripIds } },
          })
        ).count;
        deletionCounts.tripDocument = (
          await tx.tripDocument.deleteMany({
            where: { tripId: { in: tripIds } },
          })
        ).count;
        deletionCounts.driverWalletTransaction = (
          await tx.driverWalletTransaction.deleteMany({
            where: { tripId: { in: tripIds } },
          })
        ).count;
      } else {
        deletionCounts.tripDocumentRequirement = 0;
        deletionCounts.tripPayoutLine = 0;
        deletionCounts.tripDocument = 0;
        deletionCounts.driverWalletTransaction = 0;
      }

      if (jobIds.length) {
        deletionCounts.jobCharge = (
          await tx.jobCharge.deleteMany({ where: { jobId: { in: jobIds } } })
        ).count;
        deletionCounts.jobItem = (
          await tx.jobItem.deleteMany({ where: { jobId: { in: jobIds } } })
        ).count;
        deletionCounts.jobDocument = (
          await tx.jobDocument.deleteMany({ where: { jobId: { in: jobIds } } })
        ).count;
      } else {
        deletionCounts.jobCharge = 0;
        deletionCounts.jobItem = 0;
        deletionCounts.jobDocument = 0;
      }

      if (jobIds.length || tripIds.length) {
        const walletEntryOr: Prisma.driver_wallet_entriesWhereInput[] = [];
        if (jobIds.length) {
          walletEntryOr.push({ sourceType: "JOB", sourceId: { in: jobIds } });
        }
        if (tripIds.length) {
          walletEntryOr.push({ sourceType: "TRIP", sourceId: { in: tripIds } });
        }
        if (walletEntryOr.length) {
          deletionCounts.driver_wallet_entries = (
            await tx.driver_wallet_entries.deleteMany({
              where: {
                ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
                OR: walletEntryOr,
              },
            })
          ).count;
        } else {
          deletionCounts.driver_wallet_entries = 0;
        }
      } else {
        deletionCounts.driver_wallet_entries = 0;
      }

      // Stops / Pod / PodPhotoDocument cascade from Trip delete.
      deletionCounts.trip = (
        await tx.trip.deleteMany({ where: tripWhere(filter) })
      ).count;
      deletionCounts.job = (
        await tx.job.deleteMany({ where: tenantWhere(filter) })
      ).count;

      deletionCounts.job_internal_ref_counters = (
        await tx.job_internal_ref_counters.deleteMany({
          where: "tenantId" in filter ? { tenantId: filter.tenantId } : {},
        })
      ).count;
    });
  } catch (err) {
    console.error(
      "DB wipe transaction FAILED — no partial DB success claimed. Storage was not modified.",
    );
    throw err;
  }

  return { storagePlan, deletionCounts };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const identity = parseDatabaseIdentity(process.env.DATABASE_URL);
  printDatabaseIdentity(identity);
  assertWipeSafety(opts, identity);

  const scope = resolveWipeScope(
    { allTenants: opts.allTenants },
    {
      TENANT_ID: process.env.TENANT_ID,
      WIPE_ALL_TENANTS: process.env.WIPE_ALL_TENANTS,
    },
  );
  if (!scope.ok) {
    console.error(scope.error);
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    let filter: TenantFilter = {};

    if (scope.mode === "tenant") {
      const tenant = await prisma.tenant.findUnique({
        where: { id: scope.tenantId },
      });
      if (!tenant) {
        console.error(`Tenant not found: ${scope.tenantId}`);
        process.exit(1);
      }
      filter = { tenantId: scope.tenantId };
      console.log(`\n=== WIPE SCOPE: SINGLE TENANT ===`);
      console.log(`  tenantId: ${scope.tenantId}`);
      console.log(`  name:     ${tenant.name}`);
    } else {
      console.warn("\n=== WIPE SCOPE: ALL TENANTS ===");
      console.warn("  WARNING: This will wipe operational data for EVERY tenant.");
      console.warn("  Opt-in confirmed via --all-tenants + WIPE_ALL_TENANTS=true.");
      filter = {};
    }

    const hasTripJobItemTable = await tripJobItemTableExists(prisma);
    if (!hasTripJobItemTable) {
      console.warn(
        "Note: public.trip_job_items does not exist yet — TripJobItem delete will be skipped.",
      );
    }

    const beforeOp = await countOperational(prisma, filter, hasTripJobItemTable);
    const beforePreserved = await countPreserved(prisma, filter);
    printCounts("BEFORE", beforeOp, beforePreserved);

    if (opts.dryRun) {
      console.log("\nDry run complete — no rows or storage objects deleted.");
      console.log(
        `  Would delete ${beforeOp.storageObjectsJobDocuments} file(s) from ${JOB_DOCUMENTS_BUCKET}`,
      );
      console.log(
        `  Would delete ${beforeOp.storageObjectsPodPhotos} POD photo file(s) from ${POD_PHOTOS_BUCKET}`,
      );
      return;
    }

    console.log("\nDeleting operational data (single DB transaction)...");
    const { storagePlan, deletionCounts } = await wipeOperationalData(
      prisma,
      filter,
      hasTripJobItemTable,
    );
    printDeletionCounts(deletionCounts);

    const totalStorageObjects =
      storagePlan.jobDocumentKeys.length + storagePlan.podPhotoKeys.length;
    console.log(
      `DB wipe complete. Removing ${totalStorageObjects} storage object(s) ` +
        `(${storagePlan.jobDocumentKeys.length} from ${JOB_DOCUMENTS_BUCKET}, ` +
        `${storagePlan.podPhotoKeys.length} from ${POD_PHOTOS_BUCKET})...`,
    );
    const storageResult = await deleteStoragePlan(storagePlan);
    const failedKeyCount = storageResult.failed.reduce(
      (sum, f) => sum + f.keys.length,
      0,
    );
    console.log(
      `Storage: ${storageResult.deleted} removed, ${failedKeyCount} failed (see warnings above).`,
    );
    if (failedKeyCount > 0) {
      console.error(
        "Wipe finished with STORAGE FAILURES. DB rows were deleted; some files remain. Do not treat as fully successful.",
      );
      process.exit(2);
    }

    const afterOp = await countOperational(prisma, filter, hasTripJobItemTable);
    const afterPreserved = await countPreserved(prisma, filter);
    printCounts("AFTER", afterOp, afterPreserved);

    console.log("\nWipe finished successfully.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
