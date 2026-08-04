const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const beforeMemberships = await prisma.tenantMembership.count({
    where: { role: 'OPS' },
  });
  const beforeNotifs = await prisma.notification.count({
    where: { role: 'OPS' },
  });

  const membershipRowsUpdated = await prisma.$executeRawUnsafe(
    `UPDATE "tenant_memberships" SET role = 'TRANSPORT_STAFF'::"Role" WHERE role = 'OPS'::"Role"`,
  );
  const notificationRowsUpdated = await prisma.$executeRawUnsafe(
    `UPDATE "notifications" SET role = 'TRANSPORT_STAFF'::"Role" WHERE role = 'OPS'::"Role"`,
  );

  const afterMembershipsOps = await prisma.tenantMembership.count({
    where: { role: 'OPS' },
  });
  const afterTransportStaff = await prisma.tenantMembership.count({
    where: { role: 'TRANSPORT_STAFF' },
  });
  const warehouseDocSourceOpsUnchanged = await prisma.warehouseJobDocument.count({
    where: { source: 'OPS' },
  });

  console.log(
    JSON.stringify(
      {
        beforeMemberships,
        beforeNotifs,
        membershipRowsUpdated,
        notificationRowsUpdated,
        afterMembershipsOps,
        afterTransportStaff,
        warehouseDocSourceOpsUnchanged,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
