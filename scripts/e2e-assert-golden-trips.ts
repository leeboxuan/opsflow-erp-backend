/** Poll UAT trip/job status after Maestro. No secrets. */
import { PrismaClient, type JobStatus, type TripStatus } from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_DEFAULT_TENANT_SLUG,
  assertConfirmedUatDatabase,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

function arg(name: string, fallback: string): string {
  const prefixed = process.argv.find((a) => a.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : fallback;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const expectSeq = Number(arg("tripSequence", "1"));
  const expectTrip = (arg("tripStatus", "COMPLETED") as TripStatus);
  const expectJob = arg("jobStatus", "") as JobStatus | "";
  const timeoutMs = Number(arg("timeoutMs", "90000"));
  const prisma = new PrismaClient();
  const slug = process.env.E2E_ALLOWED_TENANT_SLUG || E2E_DEFAULT_TENANT_SLUG;
  const started = Date.now();
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new Error(`missing tenant ${slug}`);

    let last: unknown = null;
    while (Date.now() - started < timeoutMs) {
      const trips = await prisma.trip.findMany({
        where: { tenantId: tenant.id },
        select: {
          status: true,
          tripSequence: true,
          jobSequence: true,
          documents: { select: { type: true, originalName: true } },
        },
        orderBy: [{ tripSequence: "asc" }],
      });
      const jobs = await prisma.job.findMany({
        where: { tenantId: tenant.id },
        select: { internalRef: true, status: true, invoiceReadyAt: true },
      });
      const trip = trips.find((t) => (t.tripSequence ?? t.jobSequence) === expectSeq);
      last = {
        trip: trip
          ? {
              sequence: trip.tripSequence ?? trip.jobSequence,
              status: trip.status,
              docs: trip.documents.map((d) => d.type),
            }
          : null,
        jobs: jobs.map((j) => ({
          internalRef: j.internalRef,
          status: j.status,
          invoiceReady: Boolean(j.invoiceReadyAt),
        })),
      };
      const tripOk = trip?.status === expectTrip;
      const jobOk = !expectJob || jobs.every((j) => j.status === expectJob);
      if (tripOk && jobOk) {
        console.log(JSON.stringify({ ok: true, ...((last as object) ?? {}) }, null, 2));
        return;
      }
      await sleep(2000);
    }
    console.error(JSON.stringify({ ok: false, timedOut: true, last }, null, 2));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
