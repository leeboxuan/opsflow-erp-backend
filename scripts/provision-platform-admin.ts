/**
 * Break-glass: provision the first PlatformAdmin from an existing User email.
 * Product path is in-app bootstrap (GET/POST /api/platform/bootstrap*).
 *
 * Usage (local / operator runbook — NOT a public API; never run against prod
 * from agent workflows):
 *
 *   dotenv -e .env.local -- npx ts-node --project tsconfig.seed.json \
 *     scripts/provision-platform-admin.ts --email=you@opsflow.io --confirm
 *
 * Optional:
 *   --reactivate   allow DISABLED → ACTIVE when row already exists
 *   --dry-run      print intended actions without writing
 *
 * Safety:
 * - Requires explicit --confirm
 * - Does not print passwords/secrets
 * - Does not create TenantMembership
 * - Does not wipe tenants
 * - Fails if user email missing
 * - Detects existing PlatformAdmin and exits unless --reactivate
 */

import { PrismaClient, PlatformAdminStatus, UserRole } from "@prisma/client";

function parseArgs(argv: string[]) {
  let email: string | null = null;
  let confirm = false;
  let reactivate = false;
  let dryRun = false;
  for (const arg of argv) {
    if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length).trim().toLowerCase() || null;
    } else if (arg === "--confirm") {
      confirm = true;
    } else if (arg === "--reactivate") {
      reactivate = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }
  return { email, confirm, reactivate, dryRun };
}

async function main(): Promise<void> {
  const { email, confirm, reactivate, dryRun } = parseArgs(
    process.argv.slice(2),
  );
  if (!email) {
    console.error(
      "Usage: --email=<existing-user-email> --confirm [--reactivate] [--dry-run]",
    );
    process.exit(1);
  }
  if (!confirm && !dryRun) {
    console.error(
      "Refusing to run without --confirm (or --dry-run). See runbook.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`User not found for email (no secret printed).`);
      process.exit(1);
    }

    const existing = await prisma.platformAdmin.findUnique({
      where: { userId: user.id },
    });

    if (existing) {
      console.log(
        `PlatformAdmin already exists: id=${existing.id} status=${existing.status}`,
      );
      if (existing.status === PlatformAdminStatus.ACTIVE) {
        console.log("No change required.");
        return;
      }
      if (!reactivate) {
        console.error(
          "PlatformAdmin is not ACTIVE. Pass --reactivate --confirm to enable.",
        );
        process.exit(1);
      }
      if (dryRun) {
        console.log(`[dry-run] would reactivate PlatformAdmin id=${existing.id}`);
        return;
      }
      const updated = await prisma.platformAdmin.update({
        where: { id: existing.id },
        data: { status: PlatformAdminStatus.ACTIVE },
      });
      console.log(`Reactivated PlatformAdmin id=${updated.id}`);
      return;
    }

    if (dryRun) {
      console.log(
        `[dry-run] would create PlatformAdmin for userId=${user.id} (email redacted)`,
      );
      return;
    }

    if (user.role !== UserRole.SUPERADMIN) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: UserRole.SUPERADMIN },
      });
      console.log(`Set User.role=SUPERADMIN for userId=${user.id} (legacy bridge)`);
    }

    const created = await prisma.platformAdmin.create({
      data: {
        userId: user.id,
        status: PlatformAdminStatus.ACTIVE,
        notes: "Break-glass provision-platform-admin.ts",
      },
    });
    console.log(
      `Created PlatformAdmin id=${created.id} userId=${user.id} (no membership created)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
