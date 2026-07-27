/**
 * Wipe OpsFlow operational (job/trip) test data while preserving users, tenants,
 * companies, drivers, vehicles, and master/config reference data.
 *
 * Usage:
 *   npm run wipe:ops-data -- --dry-run
 *   TENANT_ID=<cuid> npm run wipe:ops-data -- --dry-run
 *   ALLOW_DATA_WIPE=true npm run wipe:ops-data
 *   ALLOW_DATA_WIPE=true TENANT_ID=<cuid> npm run wipe:ops-data
 *
 * Safety:
 *   --dry-run            Counts only; no DB or storage deletes
 *   ALLOW_DATA_WIPE=true Required for actual deletes (unless --dry-run)
 *
 * Does NOT delete Supabase auth users.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

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

type OperationalCounts = {
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
  masterLogisticsLocations: number;
  masterFiles: number;
  masterTrailerLocations: number;
  driverTripRateMasters: number;
  depotHandlingReferences: number;
};

type CliOptions = {
  dryRun: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    if (arg === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

function printHelp(): void {
  console.log(`
Wipe operational job/trip data (preserves users, tenants, master data).

Commands:
  npm run wipe:ops-data -- --dry-run
  TENANT_ID=<id> npm run wipe:ops-data -- --dry-run
  ALLOW_DATA_WIPE=true npm run wipe:ops-data
  ALLOW_DATA_WIPE=true TENANT_ID=<id> npm run wipe:ops-data

Environment:
  TENANT_ID          Optional tenant scope (default: all tenants in DB)
  ALLOW_DATA_WIPE    Must be "true" for actual deletes
  DATABASE_URL       Prisma connection (via .env.local)
  SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY  For storage cleanup

Storage buckets cleaned:
  job-documents  Job/trip documents, invoice PDFs, job-sourced company docs
  pods-photos    pod_photo_documents.photoKey for stops on trips in scope
`);
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

  const [
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

  const [
    users,
    tenants,
    tenantMemberships,
    customerCompanies,
    drivers,
    vehicles,
    fleetVehicles,
    masterLogisticsLocations,
    masterFiles,
    masterTrailerLocations,
    driverTripRateMasters,
    depotHandlingReferences,
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
    prisma.masterLogisticsLocation.count(),
    prisma.masterFile.count({ where: masterFileWhere }),
    prisma.masterTrailerLocation.count(),
    prisma.driverTripRateMaster.count({ where: rateMasterWhere }),
    prisma.depotHandlingReference.count({ where: depotWhere }),
  ]);

  return {
    users,
    tenants,
    tenantMemberships,
    customerCompanies,
    drivers,
    vehicles,
    fleetVehicles,
    masterLogisticsLocations,
    masterFiles,
    masterTrailerLocations,
    driverTripRateMasters,
    depotHandlingReferences,
  };
}

function printCounts(label: string, op: OperationalCounts, preserved: PreservedCounts): void {
  console.log(`\n=== ${label} ===`);
  console.log("Operational (target wipe scope):");
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
  console.log(`  master_logistics_locations:${preserved.masterLogisticsLocations}`);
  console.log(`  master_files:              ${preserved.masterFiles}`);
  console.log(`  master_trailer_locations:  ${preserved.masterTrailerLocations}`);
  console.log(`  driver_trip_rate_masters:  ${preserved.driverTripRateMasters}`);
  console.log(`  depot_handling_references: ${preserved.depotHandlingReferences}`);
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
): Promise<StorageDeletionPlan> {
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

  await prisma.$transaction(async (tx) => {
    const notifIds = (
      await tx.notification.findMany({
        where: notifWhere,
        select: { id: true },
      })
    ).map((n) => n.id);

    if (notifIds.length) {
      await tx.notificationRecipient.deleteMany({
        where: { notificationId: { in: notifIds } },
      });
      await tx.notification.deleteMany({ where: { id: { in: notifIds } } });
    }

    if (invoiceIds.length) {
      await tx.invoiceLineItem.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      });
      await tx.transportOrder.updateMany({
        where: { invoiceId: { in: invoiceIds } },
        data: { invoiceId: null },
      });
    }

    if (tripIds.length) {
      await tx.invoiceLineItem.deleteMany({
        where: { sourceTripId: { in: tripIds } },
      });
    }

    if (jobIds.length || invoiceIds.length) {
      await tx.customerCompanyDocument.deleteMany({
        where: {
          ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
          OR: [
            ...(jobIds.length ? [{ sourceJobId: { in: jobIds } }] : []),
            ...(invoiceIds.length ? [{ sourceInvoiceId: { in: invoiceIds } }] : []),
          ],
        },
      });
    }

    if (invoiceIds.length) {
      await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }

    const auditWhere: Prisma.AuditLogWhereInput = {
      ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
      OR: [
        { entityType: { in: [...JOB_TRIP_ENTITY_TYPES] } },
        ...(jobIds.length ? [{ entityId: { in: jobIds } }] : []),
        ...(tripIds.length ? [{ entityId: { in: tripIds } }] : []),
      ],
    };
    await tx.auditLog.deleteMany({ where: auditWhere });

    const eventWhere: Prisma.EventLogWhereInput = {
      ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
      OR: [
        { entityType: { in: [...JOB_TRIP_ENTITY_TYPES] } },
        ...(jobIds.length ? [{ entityId: { in: jobIds } }] : []),
        ...(tripIds.length ? [{ entityId: { in: tripIds } }] : []),
      ],
    };
    await tx.eventLog.deleteMany({ where: eventWhere });

    if (tripIds.length) {
      await tx.tripDocumentRequirement.deleteMany({
        where: { tripId: { in: tripIds } },
      });
      await tx.tripPayoutLine.deleteMany({
        where: { tripId: { in: tripIds } },
      });
      await tx.tripDocument.deleteMany({
        where: { tripId: { in: tripIds } },
      });
      await tx.driverWalletTransaction.deleteMany({
        where: { tripId: { in: tripIds } },
      });
    }

    if (jobIds.length) {
      await tx.jobCharge.deleteMany({ where: { jobId: { in: jobIds } } });
      await tx.jobItem.deleteMany({ where: { jobId: { in: jobIds } } });
      await tx.jobDocument.deleteMany({ where: { jobId: { in: jobIds } } });
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
        await tx.driver_wallet_entries.deleteMany({
          where: {
            ...("tenantId" in filter ? { tenantId: filter.tenantId } : {}),
            OR: walletEntryOr,
          },
        });
      }
    }

    // Trips before jobs (trips reference jobs; children already removed).
    await tx.trip.deleteMany({ where: tripWhere(filter) });
    await tx.job.deleteMany({ where: tenantWhere(filter) });

    await tx.job_internal_ref_counters.deleteMany({
      where: "tenantId" in filter ? { tenantId: filter.tenantId } : {},
    });
  });

  return storagePlan;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const tenantId = process.env.TENANT_ID?.trim() || null;
  const allowWipe = process.env.ALLOW_DATA_WIPE === "true";
  const filter: TenantFilter = tenantId ? { tenantId } : {};

  if (!opts.dryRun && !allowWipe) {
    console.error(
      "Refusing to delete data. Set ALLOW_DATA_WIPE=true or pass --dry-run.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        console.error(`Tenant not found: ${tenantId}`);
        process.exit(1);
      }
      console.log(`Scope: tenant ${tenantId} (${tenant.name})`);
    } else {
      console.log("Scope: ALL tenants in database");
    }

    const beforeOp = await countOperational(prisma, filter);
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

    console.log("\nDeleting operational data...");
    const storagePlan = await wipeOperationalData(prisma, filter);
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

    const afterOp = await countOperational(prisma, filter);
    const afterPreserved = await countPreserved(prisma, filter);
    printCounts("AFTER", afterOp, afterPreserved);

    console.log("\nWipe finished.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
