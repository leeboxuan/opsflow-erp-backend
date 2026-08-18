const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

async function main() {
  const prisma = new PrismaClient();
  const quotationId = "cmswyt90j000f9o2n4oh8gu6j";
  const customerId = "cmswyt5sg00049o2ni4jo0itc";
  const operationPrefix = "uat-idem-1786954875917";
  const lineCount = await prisma.customerQuotationLine.count({ where: { quotationId } });
  const idemRows = await prisma.idempotencyRecord.findMany({
    where: { operationKey: { contains: operationPrefix } },
    select: { operationKey: true, status: true, resourceId: true },
  });
  await prisma.$disconnect();
  console.log(JSON.stringify({ customerId, quotationId, lineCount, idemRows }, null, 2));
}

main();
