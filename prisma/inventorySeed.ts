import { PrismaClient, InventoryBatchStatus, InventoryUnitStatus } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Set this to an existing tenant slug in your DB.
 * Example: "demo" or "opsflow"
 */
const TENANT_SLUG = process.env.SEED_TENANT_SLUG || "demo-logistics";

/**
 * How many units to create per item.
 * You can override per-item below too.
 */
const DEFAULT_UNITS = 20;

type SeedItem = {
  sku: string;
  name: string;
  reference?: string;
  units?: number;
};

const ITEMS: SeedItem[] = [
  { sku: "MAT-001", name: "Mattress (Single)", reference: "MATT-S", units: 30 },
  { sku: "MAT-002", name: "Mattress (Queen)", reference: "MATT-Q", units: 20 },
  { sku: "BOX-S", name: "Carton Box (Small)", reference: "BOX-S", units: 50 },
  { sku: "BOX-M", name: "Carton Box (Medium)", reference: "BOX-M", units: 50 },
  { sku: "BOX-L", name: "Carton Box (Large)", reference: "BOX-L", units: 50 },
  { sku: "PALLET-STD", name: "Pallet (Standard)", reference: "PLT-STD", units: 15 },
  { sku: "WRAP-ROLL", name: "Stretch Wrap Roll", reference: "WRAP-01", units: 40 },
  { sku: "TAPE-HEAVY", name: "Packing Tape (Heavy Duty)", reference: "TAPE-HD", units: 40 },
  { sku: "BUBBLE-XL", name: "Bubble Wrap (XL)", reference: "BUB-XL", units: 25 },
  { sku: "LABEL-A6", name: "Shipping Label (A6)", reference: "LBL-A6", units: 100 },
];

function nowishUpdatedAt() {
  // some of your tables use `updatedAt DateTime` (not @updatedAt)
  return new Date();
}

function pad4(n: number) {
  return String(n).padStart(4, "0");
}

export async function inventorySeed(prisma: PrismaClient, tenantSlug: string) {
    const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true, name: true },
  });

  if (!tenant) {
    throw new Error(
      `Tenant with slug "${TENANT_SLUG}" not found. Set SEED_TENANT_SLUG to an existing tenant slug.`
    );
  }

  console.log(`Seeding inventory for tenant: ${tenant.name} (${tenant.slug})`);

  // Create (or reuse) demo batch
  const batchCode = "BATCH-DEMO-001";
  const batch = await prisma.inventory_batches.upsert({
    where: { tenantId_batchCode: { tenantId: tenant.id, batchCode } },
    update: {
      status: InventoryBatchStatus.Open,
      updatedAt: nowishUpdatedAt(),
    },
    create: {
      tenantId: tenant.id,
      batchCode,
      customerName: "Demo Customer",
      customerRef: "DEMO-REF",
      notes: "Seeded demo batch",
      status: InventoryBatchStatus.Open,
    },
    select: { id: true, batchCode: true },
  });

  console.log(`Using batch: ${batch.batchCode}`);

  // Upsert items and keep metadata + desired unit count for later
  const upsertedItems: { id: string; sku: string; name: string; units: number }[] = [];
  for (const item of ITEMS) {
    const row = await prisma.inventory_items.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: item.sku } },
      update: {
        name: item.name,
        reference: item.reference ?? null,
        updatedAt: nowishUpdatedAt(),
      },
      create: {
        id: `${tenant.id}_${item.sku}`, // your model uses String @id with no default, so we must provide
        tenantId: tenant.id,
        sku: item.sku,
        name: item.name,
        reference: item.reference ?? null,
        availableQty: 0,
        updatedAt: nowishUpdatedAt(),
      },
      select: { id: true, sku: true, name: true },
    });

    upsertedItems.push({ ...row, units: item.units ?? DEFAULT_UNITS });
  }

  // Create batch_items + units for each item (idempotent-ish)
  for (const item of upsertedItems) {
    const qty = item.units;

    await prisma.inventory_batch_items.upsert({
      where: { batchId_inventoryItemId: { batchId: batch.id, inventoryItemId: item.id } },
      update: { qty, updatedAt: nowishUpdatedAt() },
      create: {
        tenantId: tenant.id,
        batchId: batch.id,
        inventoryItemId: item.id,
        qty,
      },
      select: { id: true },
    });

    // Create units. Use deterministic unitSku so reruns can skip duplicates.
    // unitSku must be unique per tenant: @@unique([tenantId, unitSku])
    const unitsToCreate: {
      tenantId: string;
      inventoryItemId: string;
      batchId: string;
      unitSku: string;
      status: InventoryUnitStatus;
    }[] = [];
    for (let i = 1; i <= qty; i++) {
      unitsToCreate.push({
        tenantId: tenant.id,
        inventoryItemId: item.id,
        batchId: batch.id,
        unitSku: `${item.sku}-${pad4(i)}`,
        status: InventoryUnitStatus.Available,
      });
    }

    // createMany + skipDuplicates makes reruns safe
    await prisma.inventory_units.createMany({
      data: unitsToCreate,
      skipDuplicates: true,
    });

    // Keep availableQty in sync with actual Available units for that item
    const availableCount = await prisma.inventory_units.count({
      where: {
        tenantId: tenant.id,
        inventoryItemId: item.id,
        status: InventoryUnitStatus.Available,
      },
    });

    await prisma.inventory_items.update({
      where: { id: item.id },
      data: { availableQty: availableCount, updatedAt: nowishUpdatedAt() },
    });

    console.log(`Seeded ${item.sku}: ${availableCount} available units`);
  }

  console.log("✅ Inventory seed complete");
}

