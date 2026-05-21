/**
 * One-time / periodic backfill: align job.status + invoiceReadyAt with trip completion.
 *
 * Usage (loads .env.local via npm script):
 *   pnpm jobs:backfill-invoice-readiness -- --dry-run
 *   pnpm jobs:backfill-invoice-readiness -- --tenant-id=<tenantId>
 *   pnpm jobs:backfill-invoice-readiness -- --dry-run --tenant-id=<tenantId> --verbose
 *
 * Flags:
 *   --dry-run          Preview changes without writing to the database
 *   --tenant-id=<id>   Limit to one tenant (omit for all tenants)
 *   --batch-size=<n>   Jobs per page (default 200)
 *   --verbose          Log each changed job id
 *   --help             Show usage
 *
 * Skips CANCELLED and COMPLETED jobs (syncJobInvoiceReadiness also skips updates on those).
 * Run on staging first, then production during a quiet window.
 */

import { JobStatus, PrismaClient } from "@prisma/client";
import { syncJobInvoiceReadiness } from "../src/ops/job-invoice-readiness";

type CliOptions = {
  dryRun: boolean;
  tenantId: string | null;
  batchSize: number;
  verbose: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    tenantId: null,
    batchSize: 200,
    verbose: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (arg === "--verbose" || arg === "-v") {
      opts.verbose = true;
      continue;
    }
    if (arg.startsWith("--tenant-id=")) {
      opts.tenantId = arg.slice("--tenant-id=".length).trim() || null;
      continue;
    }
    if (arg === "--tenant-id") {
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const n = Number(arg.slice("--batch-size=".length));
      if (Number.isFinite(n) && n > 0) opts.batchSize = Math.floor(n);
      continue;
    }
  }

  const tenantIdx = argv.indexOf("--tenant-id");
  if (tenantIdx >= 0 && argv[tenantIdx + 1] && !argv[tenantIdx + 1].startsWith("--")) {
    opts.tenantId = argv[tenantIdx + 1].trim();
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Backfill job invoice readiness (status + invoiceReadyAt from trips).

  pnpm jobs:backfill-invoice-readiness -- --dry-run
  pnpm jobs:backfill-invoice-readiness -- --tenant-id=YOUR_TENANT_ID
  pnpm jobs:backfill-invoice-readiness -- --dry-run --verbose --batch-size=100
`);
}

const prisma = new PrismaClient();

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const tag = opts.dryRun
    ? "[backfill-job-invoice-readiness] DRY RUN"
    : "[backfill-job-invoice-readiness]";

  console.log(tag, "starting", {
    tenantId: opts.tenantId ?? "(all tenants)",
    batchSize: opts.batchSize,
    dryRun: opts.dryRun,
  });

  let cursor: string | null = null;
  let totalChecked = 0;
  let updatedToReadyForInvoice = 0;
  let demotedToOngoing = 0;
  let otherUpdates = 0;
  let unchanged = 0;
  let skippedTerminal = 0;
  let errors = 0;
  const errorDetails: Array<{ jobId: string; tenantId: string; message: string }> = [];

  const syncNow = new Date();

  for (;;) {
    const jobs = await prisma.job.findMany({
      where: {
        status: { notIn: [JobStatus.COMPLETED, JobStatus.CANCELLED] },
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        invoiceReadyAt: true,
      },
      orderBy: { id: "asc" },
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      take: opts.batchSize,
    });

    if (jobs.length === 0) break;
    cursor = jobs[jobs.length - 1].id;

    for (const job of jobs) {
      totalChecked += 1;
      try {
        const syncResult = await syncJobInvoiceReadiness(
          prisma,
          job.tenantId,
          job.id,
          { dryRun: opts.dryRun, invoiceReadyAtNow: syncNow },
        );

        if (!syncResult) {
          errors += 1;
          errorDetails.push({
            jobId: job.id,
            tenantId: job.tenantId,
            message: "Job not found during sync",
          });
          continue;
        }

        if (syncResult.skipped) {
          skippedTerminal += 1;
          continue;
        }

        if (!syncResult.changed) {
          unchanged += 1;
          continue;
        }

        const promoted =
          syncResult.status === JobStatus.READY_FOR_INVOICE
          && job.status !== JobStatus.READY_FOR_INVOICE;
        const demoted =
          syncResult.status === JobStatus.ONGOING
          && job.status === JobStatus.READY_FOR_INVOICE;

        if (promoted) {
          updatedToReadyForInvoice += 1;
        } else if (demoted) {
          demotedToOngoing += 1;
        } else {
          otherUpdates += 1;
        }

        if (opts.verbose) {
          console.log(tag, opts.dryRun ? "would update" : "updated", {
            jobId: job.id,
            tenantId: job.tenantId,
            fromStatus: job.status,
            toStatus: syncResult.status,
            fromInvoiceReadyAt: job.invoiceReadyAt?.toISOString() ?? null,
            toInvoiceReadyAt: syncResult.invoiceReadyAt?.toISOString() ?? null,
            billableTripCount: syncResult.billableTripCount,
            reason: syncResult.reason,
          });
        }
      } catch (error: any) {
        errors += 1;
        const message = error?.message ?? String(error);
        errorDetails.push({
          jobId: job.id,
          tenantId: job.tenantId,
          message,
        });
        console.error(tag, "error", {
          jobId: job.id,
          tenantId: job.tenantId,
          message,
        });
      }
    }
  }

  console.log(tag, "done", {
    totalChecked,
    updatedToReadyForInvoice,
    demotedToOngoing,
    otherUpdates,
    unchanged,
    skippedTerminal,
    errors,
    dryRun: opts.dryRun,
  });

  if (errorDetails.length > 0) {
    console.log(tag, "error sample (up to 20)", errorDetails.slice(0, 20));
  }

  if (errors > 0 && !opts.dryRun) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[backfill-job-invoice-readiness] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
