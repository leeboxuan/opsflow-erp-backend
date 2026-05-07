import { JobStatus, PrismaClient, TripStatus } from "@prisma/client";
import { evaluateJobInvoiceReadiness } from "../src/ops/job-invoice-readiness";

const prisma = new PrismaClient();

async function main() {
  const pageSize = 200;
  let cursor: string | null = null;

  let scanned = 0;
  let promotedReady = 0;
  let demotedOngoing = 0;
  let clearedInvoiceReadyAt = 0;
  let unchanged = 0;
  let failed = 0;

  for (;;) {
    const jobs = await prisma.job.findMany({
      where: {
        status: { notIn: [JobStatus.COMPLETED, JobStatus.CANCELLED] },
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        invoiceReadyAt: true,
        trips: {
          select: { id: true, status: true },
        },
      },
      orderBy: { id: "asc" },
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      take: pageSize,
    });

    if (jobs.length === 0) break;
    cursor = jobs[jobs.length - 1].id;

    for (const job of jobs) {
      scanned += 1;
      try {
        const readiness = evaluateJobInvoiceReadiness(
          job.trips.map((trip) => ({ id: trip.id, status: trip.status as TripStatus })),
        );
        const nextStatus = readiness.readyForInvoice
          ? JobStatus.READY_FOR_INVOICE
          : JobStatus.ONGOING;
        const nextInvoiceReadyAt = readiness.readyForInvoice
          ? (job.invoiceReadyAt ?? new Date())
          : null;

        const shouldUpdateStatus = job.status !== nextStatus;
        const shouldUpdateInvoiceReadyAt = (
          (nextInvoiceReadyAt === null && job.invoiceReadyAt !== null)
          || (nextInvoiceReadyAt !== null && job.invoiceReadyAt === null)
        );

        if (!shouldUpdateStatus && !shouldUpdateInvoiceReadyAt) {
          unchanged += 1;
          continue;
        }

        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: nextStatus,
            invoiceReadyAt: nextInvoiceReadyAt,
          },
        });

        if (nextStatus === JobStatus.READY_FOR_INVOICE && job.status !== JobStatus.READY_FOR_INVOICE) {
          promotedReady += 1;
        }
        if (nextStatus === JobStatus.ONGOING && job.status === JobStatus.READY_FOR_INVOICE) {
          demotedOngoing += 1;
        }
        if (nextInvoiceReadyAt === null && job.invoiceReadyAt !== null) {
          clearedInvoiceReadyAt += 1;
        }
      } catch (error: any) {
        failed += 1;
        console.error("[recalculate-job-readiness] failed", {
          jobId: job.id,
          tenantId: job.tenantId,
          error: error?.message ?? String(error),
        });
      }
    }
  }

  console.log("[recalculate-job-readiness] done", {
    scanned,
    promotedReady,
    demotedOngoing,
    clearedInvoiceReadyAt,
    unchanged,
    failed,
  });
}

main()
  .catch((error) => {
    console.error("[recalculate-job-readiness] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
