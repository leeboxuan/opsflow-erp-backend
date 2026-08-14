/**
 * Dedicated E2E tenant reset.
 *
 *   OPSFLOW_E2E_ALLOW_MUTATIONS=true \
 *   E2E_ALLOWED_WEB_ORIGINS=http://localhost:3000 \
 *   E2E_ALLOWED_API_BASE_URLS=http://localhost:3001/api \
 *   E2E_ALLOWED_TENANT_SLUG=e2e-uat \
 *   pnpm e2e:reset
 *
 * Deletes operational data for the E2E tenant, then E2E-prefixed customers,
 * quotations, vehicles, and drivers. Never wipes another tenant.
 * Does not delete master rate catalogues or tenant configuration.
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_DEFAULT_TENANT_SLUG,
  E2E_OWNERSHIP_NAME_PREFIX,
  E2E_OWNERSHIP_PREFIX,
  assertConfirmedUatDatabase,
  assertE2eSafety,
  e2eSafetyEnvForScripts,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();

let prisma: PrismaClient | null = null;

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  assertConfirmedUatDatabase();
  const safety = assertE2eSafety({ env: e2eSafetyEnvForScripts() });
  const slug = safety.tenantSlug || E2E_DEFAULT_TENANT_SLUG;
  prisma = new PrismaClient();

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    throw new Error(
      `E2E tenant slug "${slug}" was not found. Create it once (display name "OpsFlow E2E Logistics") before running the suite.`,
    );
  }
  if (tenant.slug !== slug) {
    throw new Error(`Resolved tenant slug mismatch: ${tenant.slug} vs ${slug}`);
  }

  const tenantId = tenant.id;
  console.log(`[e2e:reset] tenant ${tenant.slug} (${tenantId}) dryRun=${dryRun}`);

  if (dryRun) {
    const [jobs, invoices, companies] = await Promise.all([
      prisma.job.count({ where: { tenantId } }),
      prisma.invoice.count({ where: { tenantId } }),
      prisma.customer_companies.count({
        where: { tenantId, name: { startsWith: E2E_OWNERSHIP_NAME_PREFIX } },
      }),
    ]);
    console.log(`[e2e:reset] dry-run counts jobs=${jobs} invoices=${invoices} e2eCompanies=${companies}`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const jobs = await tx.job.findMany({ where: { tenantId }, select: { id: true } });
    const jobIds = jobs.map((row) => row.id);
    const trips = await tx.trip.findMany({ where: { tenantId }, select: { id: true } });
    const tripIds = trips.map((row) => row.id);
    const invoices = await tx.invoice.findMany({ where: { tenantId }, select: { id: true } });
    const invoiceIds = invoices.map((row) => row.id);

    if (invoiceIds.length) {
      await tx.invoiceChargeReservation.deleteMany({
        where: { tenantId, invoiceId: { in: invoiceIds } },
      });
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }

    if (tripIds.length) {
      await tx.tripJobItem.deleteMany({ where: { tenantId, tripId: { in: tripIds } } });
      await tx.tripDocumentRequirement.deleteMany({
        where: { tenantId, tripId: { in: tripIds } },
      });
      await tx.tripDocument.deleteMany({ where: { tenantId, tripId: { in: tripIds } } });
      await tx.tripPayoutLine.deleteMany({ where: { tenantId, tripId: { in: tripIds } } });
      await tx.driverWalletTransaction.deleteMany({
        where: { tenantId, tripId: { in: tripIds } },
      });
    }

    if (jobIds.length) {
      await tx.jobCharge.deleteMany({ where: { tenantId, jobId: { in: jobIds } } });
      await tx.jobItem.deleteMany({ where: { tenantId, jobId: { in: jobIds } } });
      await tx.jobDocument.deleteMany({ where: { tenantId, jobId: { in: jobIds } } });
    }

    await tx.trip.deleteMany({ where: { tenantId } });
    await tx.job.deleteMany({ where: { tenantId } });

    const e2eCompanies = await tx.customer_companies.findMany({
      where: { tenantId, name: { startsWith: E2E_OWNERSHIP_NAME_PREFIX } },
      select: { id: true },
    });
    const companyIds = e2eCompanies.map((row) => row.id);
    if (companyIds.length) {
      const quotations = await tx.customerQuotation.findMany({
        where: { tenantId, customerCompanyId: { in: companyIds } },
        select: { id: true },
      });
      const quotationIds = quotations.map((row) => row.id);
      if (quotationIds.length) {
        await tx.customerQuotationLine.deleteMany({
          where: { quotationId: { in: quotationIds } },
        });
        await tx.customerQuotation.deleteMany({ where: { id: { in: quotationIds } } });
      }
      const templates = await tx.customerRateTemplate.findMany({
        where: { tenantId, customerCompanyId: { in: companyIds } },
        select: { id: true },
      });
      if (templates.length) {
        await tx.customerRateTemplateRow.deleteMany({
          where: { templateId: { in: templates.map((row) => row.id) } },
        });
        await tx.customerRateTemplate.deleteMany({
          where: { id: { in: templates.map((row) => row.id) } },
        });
      }
      await tx.customer_companies.deleteMany({ where: { id: { in: companyIds } } });
    }

    await tx.vehicle.updateMany({
      where: { tenantId, plateNo: { startsWith: E2E_OWNERSHIP_PREFIX } },
      data: { driverId: null },
    });
    await tx.vehicle.deleteMany({
      where: { tenantId, plateNo: { startsWith: E2E_OWNERSHIP_PREFIX } },
    });
  });

  const e2eDrivers = await prisma.drivers.findMany({
    where: {
      tenantId,
      OR: [
        { email: { startsWith: "e2e." } },
        { name: { startsWith: E2E_OWNERSHIP_NAME_PREFIX } },
      ],
    },
    select: { id: true, userId: true, email: true },
  });

  const supabaseUrl = env("SUPABASE_PROJECT_URL") || env("SUPABASE_URL");
  const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY");
  const supabase =
    supabaseUrl && serviceRole
      ? createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })
      : null;

  for (const driver of e2eDrivers) {
    if (driver.userId) {
      await prisma.tenantMembership.deleteMany({
        where: { tenantId, userId: driver.userId },
      });
      const user = await prisma.user.findUnique({
        where: { id: driver.userId },
        select: { authUserId: true },
      });
      await prisma.drivers.deleteMany({ where: { id: driver.id } });
      const otherMemberships = await prisma.tenantMembership.count({
        where: { userId: driver.userId },
      });
      if (otherMemberships === 0) {
        await prisma.user.deleteMany({ where: { id: driver.userId } });
        if (supabase && user?.authUserId) {
          const { error } = await supabase.auth.admin.deleteUser(user.authUserId);
          if (error) {
            console.warn(`[e2e:reset] supabase auth delete skipped for ${driver.email}: ${error.message}`);
          }
        }
      }
    } else {
      await prisma.drivers.deleteMany({ where: { id: driver.id } });
    }
  }

  console.log(`[e2e:reset] completed for ${slug}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
