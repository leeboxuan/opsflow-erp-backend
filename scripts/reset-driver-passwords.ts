/**
 * Backend-only admin script: reset Supabase Auth passwords for all active DRIVER users.
 *
 * Password format: wfl<firstname>
 * - Uses drivers.name (falls back to User.name)
 * - First word only (before space)
 * - Lowercase, alphanumeric a-z 0-9 only
 *
 * Usage (loads .env.local via npm script):
 *   CONFIRM_RESET_DRIVER_PASSWORDS=true pnpm drivers:reset-passwords
 *
 * Required env:
 *   CONFIRM_RESET_DRIVER_PASSWORDS=true   Safety guard — must be set explicitly
 *   SUPABASE_SERVICE_ROLE_KEY             Service role key (never expose to clients)
 *   SUPABASE_URL or SUPABASE_PROJECT_URL  Supabase project URL
 *   DATABASE_URL                          Prisma connection (from .env.local)
 */

import { MembershipStatus, PrismaClient, Role } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const PASSWORD_PREFIX = "wfl";

/** wfl<firstname> from driver display name; null when name is missing or invalid. */
function deriveDriverResetPassword(
  name: string | null | undefined,
): string | null {
  const raw = String(name ?? "").trim();
  if (!raw) return null;

  const firstWord = raw.split(/\s+/)[0] ?? "";
  const normalized = firstWord.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return null;

  return `${PASSWORD_PREFIX}${normalized}`;
}

function resolveSupabaseUrl(): string {
  const url =
    process.env.SUPABASE_PROJECT_URL?.trim()
    || process.env.SUPABASE_URL?.trim()
    || "";
  if (!url) {
    throw new Error(
      "Missing Supabase URL. Set SUPABASE_PROJECT_URL or SUPABASE_URL in env.",
    );
  }
  return url;
}

function resolveServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. This script must run server-side only.",
    );
  }
  return key;
}

function assertSafetyGuard(): void {
  if (process.env.CONFIRM_RESET_DRIVER_PASSWORDS !== "true") {
    throw new Error(
      "Safety guard: set CONFIRM_RESET_DRIVER_PASSWORDS=true to run this script.",
    );
  }
}

async function main(): Promise<void> {
  assertSafetyGuard();
  const supabaseUrl = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();

  const prisma = new PrismaClient();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const memberships = await prisma.tenantMembership.findMany({
      where: {
        role: Role.DRIVER,
        status: MembershipStatus.Active,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            authUserId: true,
          },
        },
      },
      orderBy: [{ user: { email: "asc" } }],
    });

    const userIds = [...new Set(memberships.map((m) => m.userId))];
    const driverProfiles = userIds.length
      ? await prisma.drivers.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, name: true },
        })
      : [];

    const driverNameByUserId = new Map<string, string>();
    for (const profile of driverProfiles) {
      if (!profile.userId) continue;
      const name = profile.name?.trim();
      if (name && !driverNameByUserId.has(profile.userId)) {
        driverNameByUserId.set(profile.userId, name);
      }
    }

    const driversByUserId = new Map<
      string,
      { email: string; name: string | null; authUserId: string | null }
    >();
    for (const m of memberships) {
      if (driversByUserId.has(m.userId)) continue;
      driversByUserId.set(m.userId, {
        email: m.user.email,
        name: driverNameByUserId.get(m.userId) ?? m.user.name ?? null,
        authUserId: m.user.authUserId,
      });
    }

    const drivers = [...driversByUserId.entries()].map(([userId, row]) => ({
      userId,
      email: row.email,
      name: row.name,
      authUserId: row.authUserId,
    }));

    console.log(
      `Found ${drivers.length} active DRIVER user(s) across ${memberships.length} tenant membership(s).`,
    );
    console.log(`Password pattern: ${PASSWORD_PREFIX}<firstname> (derived per driver; not logged).`);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const driver of drivers) {
      const email = driver.email;
      const authUserId = driver.authUserId?.trim() || null;

      if (!authUserId) {
        skipped += 1;
        console.error(`[SKIP] ${email} — no authUserId on User record`);
        continue;
      }

      const password = deriveDriverResetPassword(driver.name);
      if (!password) {
        skipped += 1;
        console.error(
          `[SKIP] ${email} — missing or invalid driver name (got: ${JSON.stringify(driver.name ?? "")})`,
        );
        continue;
      }

      const { error } = await supabase.auth.admin.updateUserById(authUserId, {
        password,
      });

      if (error) {
        failed += 1;
        console.error(`[FAIL] ${email} (${authUserId}) — ${error.message}`);
        continue;
      }

      success += 1;
      console.log(`[OK] ${email} (${authUserId})`);
    }

    console.log(
      `Done. success=${success} failed=${failed} skipped=${skipped} total=${drivers.length}`,
    );

    if (failed > 0 || skipped > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
