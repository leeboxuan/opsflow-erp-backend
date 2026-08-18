/** Read-only COL + drivers snapshot */
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
    const tenant = await prisma.tenant.findUnique({
      where: { slug: "e2e-uat" },
      select: { id: true },
    });
    const [col, drivers, vehicles, users] = await Promise.all([
      prisma.job.findUnique({
        where: { id: "cmsx23i5t0002crzppkdd6ee5" },
        select: {
          id: true,
          internalRef: true,
          status: true,
          pickupDate: true,
          items: { select: { id: true, itemCode: true }, orderBy: { createdAt: "asc" } },
          trips: {
            select: {
              id: true,
              tripSequence: true,
              status: true,
              plannedStartAt: true,
              assignedDriverUserId: true,
              driverId: true,
              vehicleId: true,
              publishedAt: true,
              startedAt: true,
              closedAt: true,
              driverEarningCents: true,
              tripJobItems: { select: { jobItemId: true, containerNumberSnapshot: true } },
            },
            orderBy: { tripSequence: "asc" },
          },
        },
      }),
      prisma.drivers.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, name: true, userId: true, email: true },
      }),
      prisma.vehicle.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, plateNo: true, driverId: true },
      }),
      prisma.user.findMany({
        where: {
          memberships: { some: { tenantId: tenant.id } },
        },
        select: { id: true, name: true, email: true },
      }),
    ]);
    console.log(JSON.stringify({ col, drivers, vehicles, officeUsers: users }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
