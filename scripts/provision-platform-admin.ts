/**
 * Break-glass: provision the first PlatformAdmin from an existing User email.
 *
 * Usage (local / operator runbook — NOT a public API):
 *   dotenv -e .env.local -- npx ts-node --project tsconfig.seed.json \
 *     scripts/provision-platform-admin.ts --email=you@opsflow.io
 *
 * Safe: creates PlatformAdmin ACTIVE if missing; does not wipe or mutate tenants.
 * Prefer User.role=SUPERADMIN migration backfill when available.
 */

import { PrismaClient, PlatformAdminStatus, UserRole } from "@prisma/client";

function parseEmail(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith("--email=")) {
      return arg.slice("--email=".length).trim().toLowerCase() || null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const email = parseEmail(process.argv.slice(2));
  if (!email) {
    console.error("Usage: --email=<existing-user-email>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`User not found for email: ${email}`);
      process.exit(1);
    }

    const existing = await prisma.platformAdmin.findUnique({
      where: { userId: user.id },
    });
    if (existing) {
      console.log(
        `PlatformAdmin already exists: id=${existing.id} status=${existing.status}`,
      );
      if (existing.status !== PlatformAdminStatus.ACTIVE) {
        const updated = await prisma.platformAdmin.update({
          where: { id: existing.id },
          data: { status: PlatformAdminStatus.ACTIVE },
        });
        console.log(`Reactivated PlatformAdmin id=${updated.id}`);
      }
      return;
    }

    if (user.role !== UserRole.SUPERADMIN) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: UserRole.SUPERADMIN },
      });
      console.log(`Set User.role=SUPERADMIN for ${email} (legacy bridge)`);
    }

    const created = await prisma.platformAdmin.create({
      data: {
        userId: user.id,
        status: PlatformAdminStatus.ACTIVE,
        notes: "Break-glass provision-platform-admin.ts",
      },
    });
    console.log(`Created PlatformAdmin id=${created.id} userId=${user.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
