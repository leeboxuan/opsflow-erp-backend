import { PrismaClient } from "@prisma/client";
import { loadE2eUatEnv } from "./e2e-load-env";
import { assertConfirmedUatDatabase } from "../src/e2e/e2e-safety";

loadE2eUatEnv();
assertConfirmedUatDatabase();

async function main() {
  const prisma = new PrismaClient();
  try {
    const cols = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name IN ('invoices','invoice_line_items','job_charges','jobs','trips','trip_job_items')
       ORDER BY 1,2`,
    );
    const tables = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
      `SELECT relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND relname LIKE 'invoice%'`,
    );
    console.log(
      JSON.stringify(
        {
          invoiceTables: tables.map((r) => r.t),
          columns: cols,
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
