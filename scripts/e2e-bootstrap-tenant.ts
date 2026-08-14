/**
 * One-time E2E tenant bootstrap. Never runs unless:
 *   OPSFLOW_E2E_BOOTSTRAP_TENANT=true
 * plus the shared E2E safety gate.
 *
 *   pnpm e2e:bootstrap-tenant
 */
import { PrismaClient, TenantModule, TenantStatus } from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_DEFAULT_TENANT_NAME,
  E2E_DEFAULT_TENANT_SLUG,
  assertConfirmedUatDatabase,
  assertE2eSafety,
  e2eSafetyEnvForScripts,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();

let prisma: PrismaClient | null = null;

async function main() {
  if (String(process.env.OPSFLOW_E2E_BOOTSTRAP_TENANT ?? "").trim() !== "true") {
    throw new Error(
      "Refusing tenant bootstrap. Set OPSFLOW_E2E_BOOTSTRAP_TENANT=true after the safety gate is configured.",
    );
  }
  assertConfirmedUatDatabase();
  const safety = assertE2eSafety({ env: e2eSafetyEnvForScripts() });
  prisma = new PrismaClient();
  const slug = safety.tenantSlug || E2E_DEFAULT_TENANT_SLUG;
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  const tenant =
    existing ??
    (await prisma.tenant.create({
      data: {
        name: E2E_DEFAULT_TENANT_NAME,
        slug,
        timezone: "Asia/Singapore",
        status: TenantStatus.ACTIVE,
      },
    }));
  const requiredModules: TenantModule[] = [
    TenantModule.TRANSPORT,
    TenantModule.FINANCE,
    TenantModule.WAREHOUSING,
  ];
  await prisma.tenantModuleEntitlement.createMany({
    data: requiredModules.map((module) => ({
      tenantId: tenant.id,
      module,
      enabled: true,
    })),
    skipDuplicates: true,
  });
  await prisma.tenantModuleEntitlement.updateMany({
    where: { tenantId: tenant.id, module: { in: [TenantModule.TRANSPORT, TenantModule.FINANCE] } },
    data: { enabled: true },
  });
  console.log(
    existing
      ? `[e2e:bootstrap] tenant ${slug} already exists; modules ensured`
      : `[e2e:bootstrap] created ${slug}. Add office/driver memberships next.`,
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
