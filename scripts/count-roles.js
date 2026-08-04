const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const memberships = await p.tenantMembership.groupBy({
    by: ['role'],
    _count: true,
  });
  const notifications = await p.notification.groupBy({
    by: ['role'],
    _count: true,
  });
  console.log(JSON.stringify({ memberships, notifications }, null, 2));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
