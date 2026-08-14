/** Read-only Stage 3 inspection. No mutations. No secrets. */
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
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) throw new Error(`missing tenant ${slug}`);

    const jobs = await prisma.job.findMany({
      where: { tenantId: tenant.id },
      select: {
        internalRef: true,
        status: true,
        jobType: true,
        invoiceReadyAt: true,
        returningDepotCode: true,
        sourceCustomerQuotationId: true,
      },
    });
    const trips = await prisma.trip.findMany({
      where: { tenantId: tenant.id },
      select: {
        status: true,
        jobSequence: true,
        tripSequence: true,
        displayTitle: true,
        assignedDriverUserId: true,
        driverEarningCents: true,
        publishedAt: true,
        payoutLines: { select: { label: true, totalCents: true, amountCents: true } },
        drivers: { select: { name: true } },
      },
      orderBy: [{ jobSequence: "asc" }, { tripSequence: "asc" }],
    });
    const assignedIds = trips
      .map((t) => t.assignedDriverUserId)
      .filter((id): id is string => Boolean(id));
    const assignedUsers = assignedIds.length
      ? await prisma.user.findMany({
          where: { id: { in: assignedIds } },
          select: { id: true, name: true, displayName: true },
        })
      : [];
    const userName = new Map(
      assignedUsers.map((u) => [u.id, u.displayName || u.name || null]),
    );
    const items = await prisma.jobItem.findMany({
      where: { job: { tenantId: tenant.id } },
      select: { itemCode: true, job: { select: { internalRef: true } } },
    });
    const links = await prisma.tripJobItem.findMany({
      where: { trip: { tenantId: tenant.id } },
      select: {
        trip: { select: { jobSequence: true, tripSequence: true } },
        jobItem: { select: { itemCode: true } },
        containerNumberSnapshot: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          tenant: { slug: tenant.slug, name: tenant.name },
          jobs: jobs.map((j) => ({
            internalRef: j.internalRef,
            status: j.status,
            jobType: j.jobType,
            invoiceReady: Boolean(j.invoiceReadyAt),
            returningDepotCode: j.returningDepotCode,
            hasAcceptedQuotation: Boolean(j.sourceCustomerQuotationId),
          })),
          trips: trips.map((t) => {
            const lineCents = t.payoutLines.reduce(
              (sum, line) => sum + (line.totalCents ?? line.amountCents ?? 0),
              0,
            );
            return {
              label: `TRIP-T${String(t.tripSequence ?? t.jobSequence ?? 0).padStart(2, "0")}`,
              status: t.status,
              jobSequence: t.jobSequence,
              tripSequence: t.tripSequence,
              displayTitle: t.displayTitle,
              assignedDriverName:
                t.drivers?.name ??
                (t.assignedDriverUserId ? userName.get(t.assignedDriverUserId) ?? null : null),
              payoutLocked: t.status !== "DRAFT" && Boolean(t.publishedAt),
              payoutTotalCents: lineCents || t.driverEarningCents,
              published: Boolean(t.publishedAt),
              payoutLines: t.payoutLines.map((line) => ({
                label: line.label,
                cents: line.totalCents ?? line.amountCents,
              })),
            };
          }),
          containers: items.map((i) => ({
            jobNo: i.job.internalRef,
            containerNo: i.itemCode,
          })),
          tripJobItems: links.map((l) => ({
            label: `TRIP-T${String(l.trip.tripSequence ?? l.trip.jobSequence ?? 0).padStart(2, "0")}`,
            containerNo: l.containerNumberSnapshot ?? l.jobItem.itemCode,
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
