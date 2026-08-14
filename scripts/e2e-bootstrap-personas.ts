/**
 * Create/ensure E2E office personas on the UAT tenant.
 * Requires e2e/.env.local credentials and OPSFLOW_E2E_BOOTSTRAP_TENANT=true.
 */
import { MembershipStatus, PrismaClient, Role } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { loadE2eUatEnv } from "./e2e-load-env";
import {
  E2E_DEFAULT_TENANT_SLUG,
  assertConfirmedUatDatabase,
  assertE2eSafety,
  e2eSafetyEnvForScripts,
} from "../src/e2e/e2e-safety";

loadE2eUatEnv();

type Persona = {
  envEmail: string;
  envPassword: string;
  name: string;
  role: Role;
};

const PERSONAS: Persona[] = [
  { envEmail: "E2E_ADMIN_EMAIL", envPassword: "E2E_ADMIN_PASSWORD", name: "E2E Admin", role: Role.ADMIN },
  {
    envEmail: "E2E_TRANSPORT_EMAIL",
    envPassword: "E2E_TRANSPORT_PASSWORD",
    name: "E2E Transport",
    role: Role.TRANSPORT_STAFF,
  },
  {
    envEmail: "E2E_FINANCE_EMAIL",
    envPassword: "E2E_FINANCE_PASSWORD",
    name: "E2E Finance",
    role: Role.FINANCE,
  },
];

function required(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  if (String(process.env.OPSFLOW_E2E_BOOTSTRAP_TENANT ?? "").trim() !== "true") {
    throw new Error("Set OPSFLOW_E2E_BOOTSTRAP_TENANT=true to create personas.");
  }
  assertConfirmedUatDatabase();
  assertE2eSafety({ env: e2eSafetyEnvForScripts() });

  const prisma = new PrismaClient();
  const supabaseUrl = required("SUPABASE_PROJECT_URL");
  const serviceRole = required("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  try {
    const slug = process.env.E2E_ALLOWED_TENANT_SLUG || E2E_DEFAULT_TENANT_SLUG;
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      throw new Error(`Tenant ${slug} not found. Run pnpm e2e:bootstrap-tenant first.`);
    }

    for (const persona of PERSONAS) {
      const email = required(persona.envEmail).toLowerCase();
      const password = required(persona.envPassword);
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user?.authUserId) {
        const created = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name: persona.name, tenantId: tenant.id, role: persona.role },
        });
        if (created.error) {
          const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
          const existingAuth = listed.data.users.find((row) => row.email === email);
          if (!existingAuth) throw new Error(created.error.message);
          user = await prisma.user.upsert({
            where: { email },
            update: { name: persona.name, authUserId: existingAuth.id },
            create: { email, name: persona.name, authUserId: existingAuth.id },
          });
        } else if (created.data.user?.id) {
          user = await prisma.user.upsert({
            where: { email },
            update: { name: persona.name, authUserId: created.data.user.id },
            create: { email, name: persona.name, authUserId: created.data.user.id },
          });
        }
      } else {
        await supabase.auth.admin.updateUserById(user.authUserId, { password });
        user = await prisma.user.update({
          where: { id: user.id },
          data: { name: persona.name },
        });
      }
      if (!user) throw new Error(`Failed to provision ${persona.name}`);
      await prisma.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        update: { role: persona.role, status: MembershipStatus.Active },
        create: {
          tenantId: tenant.id,
          userId: user.id,
          role: persona.role,
          status: MembershipStatus.Active,
        },
      });
      console.log(`[e2e:personas] ensured ${persona.role} membership for ${persona.name}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
