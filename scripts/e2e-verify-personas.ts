import { loadE2eUatEnv } from "./e2e-load-env";
import { PrismaClient } from "@prisma/client";
import { assertConfirmedUatDatabase } from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

async function main() {
  const prisma = new PrismaClient();
  const api = process.env.E2E_API_BASE_URL;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: process.env.E2E_ALLOWED_TENANT_SLUG || "e2e-uat" },
      select: { slug: true },
    });
    const otherJobs = await prisma.job.count({
      where: { tenant: { slug: { not: tenant?.slug } } },
    });
    const e2eJobs = await prisma.job.count({
      where: { tenant: { slug: tenant?.slug } },
    });
    const memberships = await prisma.tenantMembership.findMany({
      where: { tenant: { slug: tenant?.slug } },
      select: { role: true, status: true, user: { select: { name: true, email: true } } },
    });
    const logins = [];
    for (const key of ["ADMIN", "TRANSPORT", "FINANCE"] as const) {
      const email = process.env[`E2E_${key}_EMAIL`];
      const password = process.env[`E2E_${key}_PASSWORD`];
      const res = await fetch(`${api}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as {
        user?: { tenantMemberships?: Array<{ role: string; tenant?: { slug?: string } }> };
      };
      logins.push({
        persona: key,
        http: res.status,
        role: body.user?.tenantMemberships?.[0]?.role ?? null,
      });
    }
    console.log(
      JSON.stringify(
        {
          tenantSlug: tenant?.slug,
          e2eJobCount: e2eJobs,
          otherTenantJobCount: otherJobs,
          memberships: memberships.map((m) => ({
            name: m.user.name,
            role: m.role,
            status: m.status,
          })),
          logins,
        },
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
