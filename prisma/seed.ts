import {
  PrismaClient,
  Role,
  MembershipStatus,
  InventoryUnitStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

/**
 * =========================
 * USERS + MEMBERSHIPS
 * =========================
 */
async function seedUsersAndMemberships(tenantId: string) {
  console.log('🌱 Seeding users & memberships...\n');

  // Admin
  const adminEmail = 'admin@demo.com';
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Demo Admin',
    },
  });

  // Driver
  const driverEmail = 'driver@demo.com';
  const driverUser = await prisma.user.upsert({
    where: { email: driverEmail },
    update: {},
    create: {
      email: driverEmail,
      name: 'Demo Driver',
    },
  });

  // Admin membership
  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId: adminUser.id,
      },
    },
    update: {
      role: Role.Admin,
      status: MembershipStatus.Active,
    },
    create: {
      tenantId,
      userId: adminUser.id,
      role: Role.Admin,
      status: MembershipStatus.Active,
    },
  });

  // Driver membership
  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId: driverUser.id,
      },
    },
    update: {
      role: Role.Driver,
      status: MembershipStatus.Active,
    },
    create: {
      tenantId,
      userId: driverUser.id,
      role: Role.Driver,
      status: MembershipStatus.Active,
    },
  });

  console.log(`✅ Admin:  ${adminUser.email}`);
  console.log(`✅ Driver: ${driverUser.email}\n`);

  return { adminUser, driverUser };
}

/**
 * =========================
 * INVENTORY
 * =========================
 */
async function seedInventory(tenantId: string) {
  console.log('🌱 Seeding inventory...\n');

  // small-small quantities so UI looks realistic
  const inventory = [
    { sku: 'MAT-001', name: 'Mattress', units: 5 },
    { sku: 'SOFA-001', name: 'Sofa', units: 3 },
    { sku: 'TB-001', name: 'Table', units: 2 },
  ];

  const seedBatch = await prisma.inventory_batches.upsert({
    where: {
      tenantId_batchCode: { tenantId, batchCode: 'SEED' },
    },
    update: {},
    create: {
      tenantId,
      batchCode: 'SEED',
    },
  });

  for (const item of inventory) {
    // Create / update inventory item
    const inventoryItem = await prisma.inventory_items.upsert({
      where: { tenantId_sku: { tenantId, sku: item.sku } },
      update: {
        name: item.name,
        availableQty: item.units, // keep in sync with units
        updatedAt: new Date(),
      },
      create: {
        id: `${tenantId}_${item.sku}`,
        tenantId,
        sku: item.sku,
        name: item.name,
        availableQty: item.units,
        updatedAt: new Date(),
      },
    });

    // Count existing units
    const existingUnits = await prisma.inventory_units.count({
      where: {
        tenantId,
        inventoryItemId: inventoryItem.id,
      },
    });

    const unitsToCreate = item.units - existingUnits;

    if (unitsToCreate > 0) {
      // ensure unitSku uniqueness even if seed is rerun
      const existingUnitSkus = await prisma.inventory_units.findMany({
        where: { tenantId, inventoryItemId: inventoryItem.id },
        select: { unitSku: true },
      });

      const usedSkus = new Set(existingUnitSkus.map((u) => u.unitSku));
      let suffix = 0;

      const newUnits = Array.from({ length: unitsToCreate }).map(() => {
        let unitSku: string;

        do {
          unitSku = `${item.sku}-${String(++suffix).padStart(4, '0')}`;
        } while (usedSkus.has(unitSku));

        usedSkus.add(unitSku);

        return {
          tenantId,
          inventoryItemId: inventoryItem.id,
          batchId: seedBatch.id,
          unitSku,
          status: InventoryUnitStatus.Available,
        };
      });

      await prisma.inventory_units.createMany({ data: newUnits });

      console.log(
        `✅ ${item.sku}: added ${unitsToCreate} units (total ${item.units})`,
      );
    } else {
      console.log(`✅ ${item.sku}: already has ${existingUnits} units`);
    }

    // extra safety: ensure availableQty reflects your target units
    // (in case something was manually edited previously)
    await prisma.inventory_items.update({
      where: { id: inventoryItem.id },
      data: { availableQty: item.units },
    });
  }

  console.log('\n✅ Inventory seeded\n');
}

/**
 * =========================
 * MAIN
 * =========================
 */
async function main() {
  console.log('🌱 Starting database seed...\n');

  // Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-logistics' },
    update: {},
    create: {
      name: 'Demo Logistics',
      slug: 'demo-logistics',
    },
  });

  console.log(`✅ Tenant: ${tenant.name} (${tenant.slug})\n`);

  const { adminUser, driverUser } = await seedUsersAndMemberships(tenant.id);

  await seedInventory(tenant.id);

  console.log('🎉 Seed completed successfully!\n');
  console.log('══════════════════════════════════════════════');
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
