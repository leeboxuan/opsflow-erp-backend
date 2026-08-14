import { PrismaClient } from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import { assertConfirmedUatDatabase } from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT migration_name, started_at, finished_at, rolled_back_at, logs IS NOT NULL AS has_logs FROM "_prisma_migrations" ORDER BY started_at`,
    );
    const tables = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`,
    );
    console.log(JSON.stringify({ migrations: rows, tables: tables.map((r) => r.t) }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
