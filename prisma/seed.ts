import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { inventorySeed } from "./inventorySeed";

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...\n');

  // Create or get tenant (idempotent)
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-logistics' },
    update: {},
    create: {
      name: 'Demo Logistics',
      slug: 'demo-logistics',
    },
  });
  await inventorySeed(prisma, tenant.slug);

  console.log(`✅ Tenant: ${tenant.name} (${tenant.slug})`);

  // Create admin user (idempotent)
  const adminEmail = 'admin@demo.com';
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Demo Admin',
    },
  });

  console.log(`✅ Admin User: ${adminUser.email}`);

  // Create driver user (idempotent)
  const driverEmail = 'driver@demo.com';
  const driverUser = await prisma.user.upsert({
    where: { email: driverEmail },
    update: {},
    create: {
      email: driverEmail,
      name: 'Demo Driver',
    },
  });

  console.log(`✅ Driver User: ${driverUser.email}`);

  // Create admin membership (idempotent)
  const adminMembership = await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: adminUser.id,
      },
    },
    update: {
      role: Role.Admin,
      status: MembershipStatus.Active,
    },
    create: {
      tenantId: tenant.id,
      userId: adminUser.id,
      role: Role.Admin,
      status: MembershipStatus.Active,
    },
  });

  console.log(`✅ Admin Membership: ${adminUser.email} → ${tenant.name} (${adminMembership.role})`);

  // Create driver membership (idempotent)
  const driverMembership = await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: driverUser.id,
      },
    },
    update: {
      role: Role.Driver,
      status: MembershipStatus.Active,
    },
    create: {
      tenantId: tenant.id,
      userId: driverUser.id,
      role: Role.Driver,
      status: MembershipStatus.Active,
    },
  });

  console.log(`✅ Driver Membership: ${driverUser.email} → ${tenant.name} (${driverMembership.role})\n`);

  console.log('🎉 Seed completed successfully!\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 Seeded Data:');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Tenant ID: ${tenant.id}\n`);
  console.log(`Admin User:`);
  console.log(`  Email: ${adminUser.email}`);
  console.log(`  ID: ${adminUser.id}\n`);
  console.log(`Driver User:`);
  console.log(`  Email: ${driverUser.email}`);
  console.log(`  ID: ${driverUser.id}\n`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
