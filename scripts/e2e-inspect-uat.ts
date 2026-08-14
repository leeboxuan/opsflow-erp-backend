/** Read-only UAT inspection. No mutations. */
import { PrismaClient } from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_DEFAULT_TENANT_SLUG,
  assertConfirmedUatDatabase,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

async function main() {
  const prisma = new PrismaClient();
  try {
    const slug = process.env.E2E_ALLOWED_TENANT_SLUG || E2E_DEFAULT_TENANT_SLUG;
    const [tenants, migrations, tenant] = await Promise.all([
      prisma.tenant.findMany({ select: { slug: true, name: true, status: true } }),
      prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
        `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at NULLS LAST`,
      ),
      prisma.tenant.findUnique({
        where: { slug },
        select: {
          slug: true,
          name: true,
          status: true,
          moduleEntitlements: { select: { module: true, enabled: true } },
        },
      }),
    ]);
    const otherSlugs = tenants.filter((row) => row.slug !== slug).map((row) => row.slug);
    const names = migrations.map((row) => row.migration_name);
    const required = [
      "20260804200000_platform_admin_phase1",
      "20260805040000_phase4_tenant_query_indexes",
      "20260813233000_job_customer_quotation_provenance",
      "20260814001500_invoice_integrity_provenance",
    ];
    console.log(
      JSON.stringify(
        {
          tenantCount: tenants.length,
          otherTenantSlugs: otherSlugs,
          e2eTenant: tenant,
          migrationCount: names.length,
          latestMigrations: names.slice(-8),
          requiredMigrationsPresent: Object.fromEntries(
            required.map((name) => [name, names.includes(name)]),
          ),
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
