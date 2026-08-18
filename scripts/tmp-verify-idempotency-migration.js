const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const migration = await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at IS NOT NULL AS finished
      FROM "_prisma_migrations"
      WHERE migration_name = '20260817140000_onboarding_idempotency_records'
    `);
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'idempotency_records' ORDER BY indexname
    `);
    const count = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS column_count
      FROM information_schema.columns
      WHERE table_name = 'idempotency_records'
    `);
    console.log(JSON.stringify({ migration, indexes, count }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
