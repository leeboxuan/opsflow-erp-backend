/** Read-only UAT membership/role inspection. No secrets printed. */
import { PrismaClient } from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_FORBIDDEN_PRODUCTION_SUPABASE_REF,
  E2E_UAT_SUPABASE_REF,
  assertConfirmedUatDatabase,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

function datasourceHost(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw.replace(/^prisma\+/, "")).hostname;
  } catch {
    const match = raw.match(/@([^/:]+)/);
    return match?.[1] ?? null;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const directUrl = process.env.DIRECT_URL ?? "";
  const supabaseUrl = process.env.SUPABASE_PROJECT_URL || process.env.SUPABASE_URL || "";
  if (databaseUrl.includes(E2E_FORBIDDEN_PRODUCTION_SUPABASE_REF)) {
    throw new Error("Refusing production Supabase project.");
  }
  const prisma = new PrismaClient();
  try {
    const [
      legacyRoles,
      canonicalRoles,
      membershipCount,
      zeroCanonical,
      multiCanonical,
      duplicateCanonical,
      orphanRoles,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ role: string; count: bigint }>>(
        `SELECT "role"::text AS role, COUNT(*)::bigint AS count FROM "tenant_memberships" GROUP BY "role" ORDER BY role`,
      ),
      prisma.$queryRawUnsafe<Array<{ role: string; count: bigint }>>(
        `SELECT "role"::text AS role, COUNT(*)::bigint AS count FROM "tenant_membership_roles" GROUP BY "role" ORDER BY role`,
      ).catch(() => [] as Array<{ role: string; count: bigint }>),
      prisma.tenantMembership.count(),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
         FROM "tenant_memberships" m
         LEFT JOIN "tenant_membership_roles" r ON r."tenantMembershipId" = m.id
         WHERE r.id IS NULL`,
      ).catch(() => [{ count: BigInt(-1) }]),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM (
           SELECT "tenantMembershipId"
           FROM "tenant_membership_roles"
           GROUP BY "tenantMembershipId"
           HAVING COUNT(*) > 1
         ) multi`,
      ).catch(() => [{ count: BigInt(-1) }]),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM (
           SELECT "tenantMembershipId", "role"
           FROM "tenant_membership_roles"
           GROUP BY "tenantMembershipId", "role"
           HAVING COUNT(*) > 1
         ) dups`,
      ).catch(() => [{ count: BigInt(-1) }]),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
         FROM "tenant_membership_roles" r
         LEFT JOIN "tenant_memberships" m ON m.id = r."tenantMembershipId"
         WHERE m.id IS NULL`,
      ).catch(() => [{ count: BigInt(-1) }]),
    ]);

    console.log(
      JSON.stringify(
        {
          target: "UAT",
          uatSupabaseRef: E2E_UAT_SUPABASE_REF,
          refusedProductionRef: E2E_FORBIDDEN_PRODUCTION_SUPABASE_REF,
          databaseHost: datasourceHost(databaseUrl),
          directHost: datasourceHost(directUrl),
          supabaseHost: datasourceHost(supabaseUrl) ?? supabaseUrl.replace(/^https?:\/\//, "").split("/")[0],
          membershipCount,
          legacyRoleCounts: Object.fromEntries(
            legacyRoles.map((row) => [row.role, Number(row.count)]),
          ),
          canonicalRoleCounts: Object.fromEntries(
            canonicalRoles.map((row) => [row.role, Number(row.count)]),
          ),
          membershipsWithZeroCanonicalRoles: Number(zeroCanonical[0]?.count ?? -1),
          membershipsWithMultipleCanonicalRoles: Number(multiCanonical[0]?.count ?? -1),
          duplicateMembershipRolePairs: Number(duplicateCanonical[0]?.count ?? -1),
          orphanCanonicalRoleRows: Number(orphanRoles[0]?.count ?? -1),
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
