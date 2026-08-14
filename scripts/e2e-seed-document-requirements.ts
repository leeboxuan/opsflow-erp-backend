/** Seed explicit Golden document requirement snapshots when missing. No secrets. */
import { PrismaClient } from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_DEFAULT_TENANT_SLUG,
  assertConfirmedUatDatabase,
} from "../src/e2e/e2e-safety";
import { ensureDefaultTripDocumentRequirementSnapshots } from "../src/transport/workflows/trip-document-requirements";

loadE2eUatEnv();
assertConfirmedUatDatabase();

async function main() {
  const prisma = new PrismaClient();
  try {
    const slug = process.env.E2E_ALLOWED_TENANT_SLUG || E2E_DEFAULT_TENANT_SLUG;
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) throw new Error(`missing tenant ${slug}`);

    const trips = await prisma.trip.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, tripSequence: true },
      orderBy: { tripSequence: "asc" },
    });

    await ensureDefaultTripDocumentRequirementSnapshots(
      prisma,
      tenant.id,
      trips.map((trip) => trip.id),
    );

    const requirements = await prisma.tripDocumentRequirement.findMany({
      where: { tenantId: tenant.id },
      select: {
        tripId: true,
        type: true,
        isRequired: true,
        requiresSignature: true,
      },
      orderBy: [{ tripId: "asc" }, { sortOrder: "asc" }],
    });

    console.log(
      JSON.stringify({
        tripCount: trips.length,
        requirementCount: requirements.length,
        requirements: requirements.map((row) => ({
          type: row.type,
          isRequired: row.isRequired,
          requiresSignature: row.requiresSignature,
        })),
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
