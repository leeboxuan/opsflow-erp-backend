/**
 * Idempotent E2E master rate catalogues for the dedicated tenant.
 * Retained across `pnpm e2e:reset`. Amounts match e2e/data/golden-operating-day.ts.
 *
 *   pnpm e2e:bootstrap-catalogues
 */
import {
  LogisticsLocationType,
  MasterRateDatasetStatus,
  MasterRateDatasetType,
  PrismaClient,
} from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_DEFAULT_TENANT_SLUG,
  assertConfirmedUatDatabase,
  assertE2eSafety,
  e2eSafetyEnvForScripts,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();

/** Keep in sync with opsflow-erp-web-v2/e2e/data/golden-operating-day.ts */
const GOLDEN_CHARGES = {
  truckingCents: 50_000,
  dhcCents: 8_000,
} as const;

const CATALOGUES: Array<{
  type: MasterRateDatasetType;
  rows: Array<{
    code: string;
    label: string;
    section: string;
    rateCents: number;
  }>;
}> = [
  {
    type: MasterRateDatasetType.QUOTATION,
    rows: [
      {
        code: "E2E-TRK-20",
        label: "E2E 20ft trucking",
        section: "Trucking",
        rateCents: GOLDEN_CHARGES.truckingCents,
      },
    ],
  },
  {
    type: MasterRateDatasetType.DHC_RATES,
    rows: [
      {
        code: "E2E-DHC-20",
        label: "E2E depot handling",
        section: "DHC",
        rateCents: GOLDEN_CHARGES.dhcCents,
      },
    ],
  },
  {
    type: MasterRateDatasetType.TRUCKING_RATES,
    rows: [
      {
        code: "E2E-PAY-BASE",
        label: "E2E driver trip payout",
        section: "Payout",
        rateCents: 12_000,
      },
    ],
  },
];

let prisma: PrismaClient | null = null;

async function ensureCatalogue(
  tenantId: string,
  spec: (typeof CATALOGUES)[number],
) {
  const existing =
    (await prisma!.masterRateDataset.findFirst({
      where: { tenantId, type: spec.type, isCurrent: true },
    })) ??
    (await prisma!.masterRateDataset.findFirst({
      where: { tenantId, type: spec.type, status: MasterRateDatasetStatus.ACTIVE },
      orderBy: { versionNo: "desc" },
    }));

  const dataset =
    existing ??
    (await prisma!.masterRateDataset.create({
      data: {
        tenantId,
        type: spec.type,
        versionNo: 1,
        status: MasterRateDatasetStatus.ACTIVE,
        isCurrent: true,
      },
    }));

  if (existing && (!existing.isCurrent || existing.status !== MasterRateDatasetStatus.ACTIVE)) {
    await prisma!.masterRateDataset.update({
      where: { id: existing.id },
      data: { isCurrent: true, status: MasterRateDatasetStatus.ACTIVE },
    });
  }

  await prisma!.masterRateDatasetRow.deleteMany({
    where: { tenantId, datasetId: dataset.id, code: { startsWith: "E2E-" } },
  });

  const already = await prisma!.masterRateDatasetRow.findMany({
    where: { tenantId, datasetId: dataset.id },
    select: { code: true },
  });
  const have = new Set(already.map((row) => row.code));
  const missing = spec.rows.filter((row) => !have.has(row.code));
  if (missing.length > 0) {
    await prisma!.masterRateDatasetRow.createMany({
      data: missing.map((row, index) => ({
        datasetId: dataset.id,
        tenantId,
        code: row.code,
        label: row.label,
        section: row.section,
        currency: "SGD",
        rateCents: row.rateCents,
        requiresManualAmount: false,
        isActive: true,
        sortOrder: already.length + index,
      })),
    });
  }

  const rowCount = await prisma!.masterRateDatasetRow.count({
    where: { tenantId, datasetId: dataset.id, isActive: true },
  });
  return { type: spec.type, datasetIdLen: dataset.id.length, rowCount, created: !existing };
}

async function main() {
  assertConfirmedUatDatabase();
  const safety = assertE2eSafety({ env: e2eSafetyEnvForScripts() });
  const slug = safety.tenantSlug || E2E_DEFAULT_TENANT_SLUG;
  prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new Error(`Tenant ${slug} not found. Run pnpm e2e:bootstrap-tenant first.`);
  }
  const results = [];
  for (const spec of CATALOGUES) {
    results.push(await ensureCatalogue(tenant.id, spec));
  }
  const depotSpecs = [
    {
      code: "DEPOT_DEFAULT",
      name: "Default company depot",
      addressLine1: "7 Gul Circle",
      postalCode: "629563",
      lat: 1.318,
      lng: 103.677,
    },
    {
      code: "E2E-DEPOT-RETURN",
      name: "E2E Return Depot",
      addressLine1: "7 Gul Circle",
      postalCode: "629563",
      lat: 1.318,
      lng: 103.677,
    },
  ];
  const depots = [];
  for (const spec of depotSpecs) {
    depots.push(
      await prisma.masterLogisticsLocation.upsert({
        where: { code: spec.code },
        update: {
          name: spec.name,
          label: spec.name,
          type: LogisticsLocationType.DEPOT,
          addressLine1: spec.addressLine1,
          postalCode: spec.postalCode,
          lat: spec.lat,
          lng: spec.lng,
          isActive: true,
        },
        create: {
          code: spec.code,
          name: spec.name,
          label: spec.name,
          type: LogisticsLocationType.DEPOT,
          addressLine1: spec.addressLine1,
          postalCode: spec.postalCode,
          lat: spec.lat,
          lng: spec.lng,
          isActive: true,
          sortOrder: 10,
        },
      }),
    );
  }
  console.log(
    JSON.stringify(
      {
        tenantSlug: slug,
        catalogues: results,
        depots: depots.map((row) => ({ code: row.code, name: row.name })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
