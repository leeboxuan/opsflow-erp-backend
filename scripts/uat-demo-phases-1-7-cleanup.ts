/**
 * Cleanup ONLY records owned by prefix UAT-DEMO-PHASES-1-7.
 * Does not run automatically — invoke explicitly when needed.
 *
 * Safety: loads .env only, proves UAT ref, never touches unrelated rows.
 */
import { PrismaClient } from "@prisma/client";
import {
  assertUatOrStop,
  DEMO_PREFIX,
  redactId,
  tenantSlug,
} from "./uat-demo-phases-1-7-lib";

async function main() {
  assertUatOrStop();
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { slug: tenantSlug(), status: "ACTIVE" },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new Error("STOP: tenant not found");

    const jobs = await prisma.job.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { externalRef: { startsWith: DEMO_PREFIX } },
          { internalRef: { startsWith: DEMO_PREFIX } },
        ],
      },
      select: { id: true, externalRef: true, internalRef: true },
    });
    const jobIds = jobs.map((j) => j.id);

    const trips = await prisma.trip.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { title: { startsWith: DEMO_PREFIX } },
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
          { invoiceNo: { startsWith: DEMO_PREFIX } },
          { notes: DEMO_PREFIX },
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
          { remarks: { startsWith: DEMO_PREFIX } },
          ...(tripIds.length ? [{ tripId: { in: tripIds } }] : []),
          ...(jobIds.length ? [{ jobId: { in: jobIds } }] : []),
        ],
      },
      select: { id: true },
    });
    const expenseIds = expenses.map((e) => e.id);

    // Delete children first (prefix-scoped only)
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

    // Orphan storage-key docs under prefix (if any left)
    deleted.orphanTripDocuments = (
      await prisma.tripDocument.deleteMany({
        where: {
          tenantId: tenant.id,
          storageKey: { startsWith: DEMO_PREFIX },
        },
      })
    ).count;
    deleted.orphanExpenseAttachments = (
      await prisma.tripExpenseAttachment.deleteMany({
        where: {
          tenantId: tenant.id,
          storageKey: { startsWith: DEMO_PREFIX },
        },
      })
    ).count;

    console.log(
      JSON.stringify(
        {
          prefix: DEMO_PREFIX,
          tenant: { id: redactId(tenant.id), slug: tenant.slug },
          matched: {
            jobs: jobs.map((j) => ({
              id: redactId(j.id),
              externalRef: j.externalRef,
            })),
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
