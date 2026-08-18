const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const migrations = await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at, rolled_back_at, LEFT(logs, 120) AS logs
      FROM "_prisma_migrations"
      WHERE migration_name LIKE '%idempotency%'
    `);
    const objects = await prisma.$queryRawUnsafe(`
      SELECT to_regclass('public.idempotency_records')::text AS idempotency_table,
             to_regtype('public."IdempotencyRecordStatus"')::text AS idempotency_enum
    `);
    console.log(JSON.stringify({ migrations, objects }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
