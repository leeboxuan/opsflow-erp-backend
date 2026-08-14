/** Read-only Stage 1 inspection. No mutations. No secrets. */
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
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new Error(`missing tenant ${slug}`);

    const customers = await prisma.customer_companies.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, name: true },
    });
    const templates = await prisma.customerRateTemplate.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        status: true,
        customerCompanyId: true,
        name: true,
        _count: { select: { rows: true } },
      },
    });
    const templateRows = await prisma.customerRateTemplateRow.findMany({
      where: { template: { tenantId: tenant.id } },
      select: { code: true, label: true, rateCents: true, isActive: true },
      take: 20,
    });
    const masterDatasets = await prisma.masterRateDataset.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        type: true,
        status: true,
        isCurrent: true,
        versionNo: true,
        _count: { select: { rows: true } },
      },
    });
    const quotations = await prisma.customerQuotation.findMany({
      where: { tenantId: tenant.id },
      select: { quotationNo: true, status: true, title: true, totalCents: true },
    });
    const driverRows = await prisma.drivers.findMany({
      where: { tenantId: tenant.id },
      select: { name: true, email: true, assignedVehicleId: true },
    });
    const vehicleRows = await prisma.vehicle.findMany({
      where: { tenantId: tenant.id },
      select: { plateNo: true, type: true, driverId: true },
    });

    console.log(
      JSON.stringify(
        {
          tenantSlug: tenant.slug,
          customers: customers.map((c) => ({ name: c.name })),
          templates: templates.map((t) => ({
            status: t.status,
            name: t.name,
            rowCount: t._count.rows,
            customerName: customers.find((c) => c.id === t.customerCompanyId)?.name,
          })),
          sampleTemplateRows: templateRows.map((r) => ({
            code: r.code,
            label: r.label,
            rateCents: r.rateCents,
            isActive: r.isActive,
          })),
          masterDatasets: masterDatasets.map((d) => ({
            type: d.type,
            status: d.status,
            isCurrent: d.isCurrent,
            versionNo: d.versionNo,
            rowCount: d._count.rows,
          })),
          quotations: quotations.map((q) => ({
            quotationNo: q.quotationNo,
            status: q.status,
            title: q.title,
            totalCents: q.totalCents,
          })),
          drivers: driverRows.map((d) => ({
            name: d.name,
            emailDomain: d.email.split("@")[1] ?? null,
            assigned: !!d.assignedVehicleId,
          })),
          vehicles: vehicleRows.map((v) => ({
            plateNo: v.plateNo,
            type: v.type,
            assigned: !!v.driverId,
          })),
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
