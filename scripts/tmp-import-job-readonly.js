/** Read-only IMPORT job detail. */
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function parseEnvFile(file) {
  const map = {};
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[trimmed.slice(0, i).trim()] = value;
  }
  return map;
}

const backendRoot = path.resolve(__dirname, "..");
for (const [k, v] of Object.entries(parseEnvFile(path.join(backendRoot, ".env")))) {
  if (!process.env[k]) process.env[k] = v;
}
for (const [k, v] of Object.entries(
  parseEnvFile(path.join(backendRoot, "../opsflow-erp-web-v2/e2e/.env.local")),
)) {
  process.env[k] = v;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const impJob = await prisma.job.findUnique({
      where: { id: "cmsrwwd3r0039t8srvsk9yvjz" },
      select: {
        internalRef: true,
        status: true,
        pickupDate: true,
        invoiceReadyAt: true,
        charges: { select: { label: true, amountCents: true } },
        trips: {
          select: {
            id: true,
            status: true,
            tripSequence: true,
            plannedStartAt: true,
            plannedEndAt: true,
            assignedDriverUserId: true,
            drivers: { select: { name: true } },
            publishedAt: true,
            startedAt: true,
            closedAt: true,
            driverEarningCents: true,
            payoutLines: { select: { label: true, totalCents: true } },
          },
          orderBy: { tripSequence: "asc" },
        },
      },
    });
    console.log(JSON.stringify({ impJob }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
