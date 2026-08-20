/**
 * Cleanup ONLY records owned by the current E2E UAT runId.
 *
 *   OPSFLOW_E2E_ALLOW_MUTATIONS=true \
 *   E2E_UAT_RUN_ID=E2E-UAT-... \
 *   npx dotenv -e .env -- npx ts-node --transpile-only scripts/e2e-uat-run-cleanup.ts
 *
 * Never deletes UAT-DEMO-PHASES-1-7 or unrelated rows.
 * Restores driver hasPsaPortAccess from the run manifest when present.
 */
import { PrismaClient } from "@prisma/client";
import {
  assertMutationsAllowedOrStop,
  assertUatOrStop,
  assertValidRunId,
  readManifest,
  redactId,
  RUN_ID_ENV,
  tenantSlug,
} from "./e2e-uat-run-lib";

async function main() {
  assertUatOrStop();
  assertMutationsAllowedOrStop();

  const prisma = new PrismaClient();
  try {
    const manifest = readManifest(process.env[RUN_ID_ENV]);
    const runId = manifest.runId;
    assertValidRunId(runId);
    if (runId.startsWith("UAT-DEMO-PHASES-1-7")) {
      throw new Error("STOP: refusing to clean demo prefix");
    }

    const tenant = await prisma.tenant.findFirst({
      where: {
        ...(manifest.tenantId
          ? { id: manifest.tenantId }
          : { slug: tenantSlug() }),
        status: "ACTIVE",
      },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new Error("STOP: tenant not found");

    // Restore PSA flags before deleting run rows (drivers are not run-owned).
    const restored: Record<string, { driverId: string | null; to: boolean }> = {};
    for (const key of ["A", "B"] as const) {
      const snap = manifest.psaPrevious?.[key];
      if (!snap?.driverId) continue;
      await prisma.drivers.updateMany({
        where: { tenantId: tenant.id, id: snap.driverId },
        data: { hasPsaPortAccess: snap.previousHasPsaPortAccess === true },
      });
      restored[key] = {
        driverId: redactId(snap.driverId),
        to: snap.previousHasPsaPortAccess === true,
      };
    }

    const jobs = await prisma.job.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { externalRef: { startsWith: runId } },
          { internalRef: { startsWith: runId } },
        ],
      },
      select: { id: true, externalRef: true, internalRef: true },
    });
    const jobIds = jobs.map((j) => j.id);

    const trips = await prisma.trip.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { title: { startsWith: runId } },
          ...(jobIds.length ? [{ jobId: { in: jobIds } }] : []),
        ],
      },
      select: { id: true, title: true },
    });
    const tripIds = trips.map((t) => t.id);

    const invoices = await prisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { invoiceNo: { startsWith: runId } },
          { notes: runId },
          ...(jobIds.length ? [{ sourceJobId: { in: jobIds } }] : []),
        ],
      },
      select: { id: true, invoiceNo: true },
    });
    const invoiceIds = invoices.map((i) => i.id);

    const expenses = await prisma.tripExpense.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { remarks: { startsWith: runId } },
          ...(tripIds.length ? [{ tripId: { in: tripIds } }] : []),
          ...(jobIds.length ? [{ jobId: { in: jobIds } }] : []),
        ],
      },
      select: { id: true },
    });
    const expenseIds = expenses.map((e) => e.id);

    const deleted: Record<string, number> = {};

    if (expenseIds.length) {
      deleted.tripExpenseEvents = (
        await prisma.tripExpenseEvent.deleteMany({
          where: { tenantId: tenant.id, expenseId: { in: expenseIds } },
        })
      ).count;
      deleted.tripExpenseAttachments = (
        await prisma.tripExpenseAttachment.deleteMany({
          where: { tenantId: tenant.id, expenseId: { in: expenseIds } },
        })
      ).count;
      deleted.tripExpenses = (
        await prisma.tripExpense.deleteMany({
          where: { tenantId: tenant.id, id: { in: expenseIds } },
        })
      ).count;
    }

    if (tripIds.length) {
      deleted.tripDocuments = (
        await prisma.tripDocument.deleteMany({
          where: { tenantId: tenant.id, tripId: { in: tripIds } },
        })
      ).count;
      deleted.tripDocumentRequirements = (
        await prisma.tripDocumentRequirement.deleteMany({
          where: { tenantId: tenant.id, tripId: { in: tripIds } },
        })
      ).count;
      deleted.tripPayoutLines = (
        await prisma.tripPayoutLine.deleteMany({
          where: { tenantId: tenant.id, tripId: { in: tripIds } },
        })
      ).count;
    }

    if (invoiceIds.length) {
      deleted.invoiceChargeReservations = (
        await prisma.invoiceChargeReservation.deleteMany({
          where: { tenantId: tenant.id, invoiceId: { in: invoiceIds } },
        })
      ).count;
      deleted.invoiceLineItems = (
        await prisma.invoiceLineItem.deleteMany({
          where: { tenantId: tenant.id, invoiceId: { in: invoiceIds } },
        })
      ).count;
      deleted.invoices = (
        await prisma.invoice.deleteMany({
          where: { tenantId: tenant.id, id: { in: invoiceIds } },
        })
      ).count;
    }

    if (jobIds.length) {
      deleted.jobCharges = (
        await prisma.jobCharge.deleteMany({
          where: { tenantId: tenant.id, jobId: { in: jobIds } },
        })
      ).count;
      deleted.jobTypeAssignments = (
        await prisma.jobTypeAssignment.deleteMany({
          where: { tenantId: tenant.id, jobId: { in: jobIds } },
        })
      ).count;
      deleted.jobItems = (
        await prisma.jobItem.deleteMany({
          where: { tenantId: tenant.id, jobId: { in: jobIds } },
        })
      ).count;
    }

    if (tripIds.length) {
      deleted.trips = (
        await prisma.trip.deleteMany({
          where: { tenantId: tenant.id, id: { in: tripIds } },
        })
      ).count;
    }

    if (jobIds.length) {
      deleted.jobs = (
        await prisma.job.deleteMany({
          where: { tenantId: tenant.id, id: { in: jobIds } },
        })
      ).count;
    }

    deleted.orphanTripDocuments = (
      await prisma.tripDocument.deleteMany({
        where: {
          tenantId: tenant.id,
          storageKey: { startsWith: runId },
        },
      })
    ).count;
    deleted.orphanExpenseAttachments = (
      await prisma.tripExpenseAttachment.deleteMany({
        where: {
          tenantId: tenant.id,
          storageKey: { startsWith: runId },
        },
      })
    ).count;

    console.log(
      JSON.stringify(
        {
          runId,
          tenant: { id: redactId(tenant.id), slug: tenant.slug },
          restoredPsa: restored,
          matched: {
            jobs: jobs.length,
            trips: trips.length,
            invoices: invoices.length,
            expenses: expenses.length,
          },
          deleted,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
