/** Read-only trip documents + status. No secrets. */
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
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) throw new Error(`missing tenant ${slug}`);
    const trips = await prisma.trip.findMany({
      where: { tenantId: tenant.id },
      select: {
        status: true,
        tripSequence: true,
        trailerNumber: true,
        documents: { select: { type: true, originalName: true, isSigned: true, isActive: true } },
        job: { select: { internalRef: true, status: true } },
      },
      orderBy: { tripSequence: "asc" },
    });
    console.log(
      JSON.stringify(
        trips.map((t) => ({
          seq: t.tripSequence,
          status: t.status,
          job: t.job?.internalRef,
          jobStatus: t.job?.status,
          trailerNumber: t.trailerNumber,
          docs: t.documents.map((d) => ({
            type: d.type,
            signed: d.isSigned,
            active: d.isActive,
          })),
        })),
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
