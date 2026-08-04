/**
 * Phase 5 endpoint query-shape / latency benchmark harness.
 *
 * Safe defaults:
 * - Refuses remote/production-like DATABASE_URL hosts unless ALLOW_REMOTE_BENCHMARK=1
 * - Never prints connection strings or row payloads
 * - Intended for local Postgres or an explicitly authorized staging clone
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/phase5-query-benchmark.ts
 *   BENCHMARK_MODE=plan npx ts-node --transpile-only scripts/phase5-query-benchmark.ts
 *
 * Environment:
 *   DATABASE_URL           required
 *   BENCHMARK_TENANT_ID    optional synthetic tenant id for count probes
 *   ALLOW_REMOTE_BENCHMARK set to 1 only for authorized non-production remotes
 *   BENCHMARK_MODE         plan | counts (default: plan)
 */

import { PrismaClient } from "@prisma/client";

function hostLooksLocal(url: string): boolean {
  return /@(localhost|127\.0\.0\.1)([:/]|$)/i.test(url) || /:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(url);
}

function hostLooksRemoteCloud(url: string): boolean {
  return /(supabase|amazonaws|neon\.tech|render\.com|pooler)/i.test(url);
}

function assertSafeTarget(url: string | undefined): asserts url is string {
  if (!url || !url.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  if (hostLooksLocal(url)) return;
  if (process.env.ALLOW_REMOTE_BENCHMARK === "1") {
    if (hostLooksRemoteCloud(url)) {
      console.warn(
        "[phase5-benchmark] ALLOW_REMOTE_BENCHMARK=1: remote host permitted. Confirm this is not production.",
      );
    }
    return;
  }
  throw new Error(
    "Refusing remote DATABASE_URL. Use local Postgres, or set ALLOW_REMOTE_BENCHMARK=1 for an authorized non-production target.",
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  assertSafeTarget(url);

  const mode = (process.env.BENCHMARK_MODE || "plan").toLowerCase();
  const tenantId = process.env.BENCHMARK_TENANT_ID || null;
  const prisma = new PrismaClient();

  console.log(
    JSON.stringify({
      mode,
      tenantScoped: Boolean(tenantId),
      indexesMigration: "20260805040000_phase4_tenant_query_indexes",
      note: "This script does not apply migrations and does not print payloads.",
    }),
  );

  try {
    if (mode === "plan") {
      const plans: Record<string, unknown> = {};
      // EXPLAIN only — no ANALYZE by default (safer on shared DBs).
      const queries: Array<{ name: string; sql: string }> = [
        {
          name: "jobs_by_tenant_createdAt",
          sql: `EXPLAIN (FORMAT JSON) SELECT id FROM jobs WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
        },
        {
          name: "jobs_by_tenant_updatedAt",
          sql: `EXPLAIN (FORMAT JSON) SELECT id FROM jobs WHERE "tenantId" = $1 ORDER BY "updatedAt" DESC LIMIT 50`,
        },
        {
          name: "invoices_by_tenant_status",
          sql: `EXPLAIN (FORMAT JSON) SELECT id FROM invoices WHERE "tenantId" = $1 AND status = 'Draft' LIMIT 50`,
        },
        {
          name: "invoices_by_tenant_sourceJobId",
          sql: `EXPLAIN (FORMAT JSON) SELECT id FROM invoices WHERE "tenantId" = $1 AND "sourceJobId" = $2 LIMIT 50`,
        },
        {
          name: "trips_dispatch_day_window",
          sql: `EXPLAIN (FORMAT JSON) SELECT id FROM trips WHERE "tenantId" = $1 AND status <> 'DRAFT' AND (("plannedStartAt" >= $2 AND "plannedStartAt" < $3) OR ("plannedStartAt" IS NULL AND "createdAt" >= $2 AND "createdAt" < $3)) LIMIT 200`,
        },
      ];

      const tid = tenantId || "00000000-0000-0000-0000-000000000000";
      const dayStart = new Date("2026-05-05T00:00:00.000Z");
      const dayEnd = new Date("2026-05-06T00:00:00.000Z");
      const fakeJob = "00000000-0000-0000-0000-000000000001";

      for (const q of queries) {
        const params =
          q.name === "invoices_by_tenant_sourceJobId"
            ? [tid, fakeJob]
            : q.name === "trips_dispatch_day_window"
              ? [tid, dayStart, dayEnd]
              : [tid];
        const rows = await prisma.$queryRawUnsafe<any[]>(q.sql, ...params);
        const plan = rows?.[0]?.["QUERY PLAN"]?.[0] ?? rows?.[0] ?? null;
        plans[q.name] = {
          nodeType: plan?.Plan?.["Node Type"] ?? null,
          indexName: plan?.Plan?.["Index Name"] ?? plan?.Plan?.["Index Cond"] ?? null,
          planRows: plan?.Plan?.["Plan Rows"] ?? null,
          totalCost: plan?.Plan?.["Total Cost"] ?? null,
        };
      }
      console.log(JSON.stringify({ plans }, null, 2));
      return;
    }

    if (mode === "counts") {
      if (!tenantId) {
        throw new Error("BENCHMARK_TENANT_ID required for counts mode");
      }
      const [jobs, trips, invoices, batches] = await Promise.all([
        prisma.job.count({ where: { tenantId } }),
        prisma.trip.count({ where: { tenantId } }),
        prisma.invoice.count({ where: { tenantId } }),
        prisma.inventory_batches.count({ where: { tenantId } }),
      ]);
      console.log(JSON.stringify({ counts: { jobs, trips, invoices, batches } }));
      return;
    }

    throw new Error(`Unknown BENCHMARK_MODE=${mode}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
