// prisma/seed.ts
import {
  PrismaClient,
  Role,
  MembershipStatus,
  InventoryUnitStatus,
  OrderStatus,
  StopType,
  StopStatus,
  PodStatus,
  TripStatus,
  InventoryBatchStatus,
  DoStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "demo-logistics";
const TENANT_NAME = "Demo Logistics";

// internalRef format: DB-YYYY-MM-SS-IMP
const TENANT_PREFIX = "DB";
const INTERNAL_REF_SUFFIX = "IMP";

// ✅ Supabase Auth UID -> email mapping (provided by you)
const AUTH_UIDS: Record<string, string> = {
  "admin@demo.com": "fc6d6ce1-2009-4b7e-b403-55c96592fd33",
  "customer@demo.com": "ea24824d-3c81-495a-8b00-fba3007888f8",
  "driver@demo.com": "580ea499-1d99-408f-8e47-7f0bcc80a98a",
  "driver2@demo.com": "0e44ac74-0679-43c1-841d-8261f6764670",
  "driver3@demo.com": "adcf6d6b-7710-4df8-abfb-785cb3f54a39",
  "driver4@demo.com": "aa740c7a-ae90-4021-9b9b-c16b76474de3",
  "driver5@demo.com": "269a7906-58c6-4359-b144-c012237d3214",
};

const USERS = {
  admin: { email: "admin@demo.com", name: "Demo Admin", role: Role.ADMIN },
  customer: {
    email: "customer@demo.com",
    name: "Demo Customer",
    role: Role.CUSTOMER,
  },
  drivers: [
    { email: "driver@demo.com", name: "Driver 1" },
    { email: "driver2@demo.com", name: "Driver 2" },
    { email: "driver3@demo.com", name: "Driver 3" },
    { email: "driver4@demo.com", name: "Driver 4" },
    { email: "driver5@demo.com", name: "Driver 5" },
  ],
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function yyyymm(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  return { yyyy, mm };
}

async function generateInternalRef(tenantId: string, createdAt: Date) {
  const { yyyy, mm } = yyyymm(createdAt);

  const monthStart = new Date(
    Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), 1, 0, 0, 0)
  );
  const monthEnd = new Date(
    Date.UTC(
      createdAt.getUTCFullYear(),
      createdAt.getUTCMonth() + 1,
      1,
      0,
      0,
      0
    )
  );

  const countThisMonth = await prisma.transportOrder.count({
    where: {
      tenantId,
      createdAt: { gte: monthStart, lt: monthEnd },
      internalRef: { not: null },
    },
  });

  const seq = countThisMonth + 1;
  const ss = pad2(seq);

  return `${TENANT_PREFIX}-${yyyy}-${mm}-${ss}-${INTERNAL_REF_SUFFIX}`;
}

async function upsertUser(email: string, name: string) {
  const authUserId = AUTH_UIDS[email] ?? null;
  return prisma.user.upsert({
    where: { email },
    update: { name, authUserId },
    create: { email, name, authUserId },
  });
}

async function upsertMembership(tenantId: string, userId: string, role: Role) {
  return prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    update: { role, status: MembershipStatus.Active },
    create: { tenantId, userId, role, status: MembershipStatus.Active },
  });
}

async function upsertDriverRow(params: {
  tenantId: string;
  userId: string;
  email: string;
  name: string;
  phone: string;
}) {
  const { tenantId, userId, email, name, phone } = params;
  const driverId = `drv_${tenantId}_${email.replace(/[@.]/g, "_")}`;

  return prisma.drivers.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: {
      name,
      phone,
      userId,
      updatedAt: new Date(),
    },
    create: {
      id: driverId,
      tenantId,
      email,
      name,
      phone,
      userId,
      updatedAt: new Date(),
    },
  });
}

async function upsertVehicle(tenantId: string, vehicleNumber: string) {
  return prisma.vehicle.upsert({
    where: { tenantId_vehicleNumber: { tenantId, vehicleNumber } },
    update: {},
    create: { tenantId, vehicleNumber },
  });
}

async function seedInventory(tenantId: string) {
  console.log("🌱 Seeding inventory...");

  // Make stock plentiful so seed never fails
  const inventory = [
    { sku: "MAT-001", name: "Mattress", units: 50 },
    { sku: "SOFA-001", name: "Sofa", units: 30 },
    { sku: "TB-001", name: "Table", units: 20 },
  ];

  const seedBatch = await prisma.inventory_batches.upsert({
    where: { tenantId_containerNumber: { tenantId, containerNumber: "SEED" } },
    update: { status: InventoryBatchStatus.Open },
    create: {
      tenantId,
      containerNumber: "SEED",
      status: InventoryBatchStatus.Open,
      receivedAt: new Date(),
      notes: "Seed batch",
    },
  });

  for (const item of inventory) {
    const inventoryItem = await prisma.inventory_items.upsert({
      where: { tenantId_sku: { tenantId, sku: item.sku } },
      update: {
        name: item.name,
        availableQty: item.units,
        updatedAt: new Date(),
      },
      create: {
        id: `${tenantId}_${item.sku}`, // stable id
        tenantId,
        sku: item.sku,
        name: item.name,
        availableQty: item.units,
        updatedAt: new Date(),
      },
    });

    await prisma.inventory_batch_items.upsert({
      where: {
        batchId_inventoryItemId: {
          batchId: seedBatch.id,
          inventoryItemId: inventoryItem.id,
        },
      },
      update: { qty: item.units },
      create: {
        tenantId,
        batchId: seedBatch.id,
        inventoryItemId: inventoryItem.id,
        qty: item.units,
      },
    });

    // Ensure units exist; top up if short
    const existingUnits = await prisma.inventory_units.count({
      where: { tenantId, inventoryItemId: inventoryItem.id },
    });

    const unitsToCreate = item.units - existingUnits;
    if (unitsToCreate > 0) {
      const existingSkus = await prisma.inventory_units.findMany({
        where: { tenantId, inventoryItemId: inventoryItem.id },
        select: { unitSku: true },
      });
      const used = new Set(existingSkus.map((u) => u.unitSku));
      let suffix = existingUnits;

      const newUnits = Array.from({ length: unitsToCreate }).map(() => {
        let unitSku: string;
        do {
          unitSku = `${item.sku}-${String(++suffix).padStart(4, "0")}`;
        } while (used.has(unitSku));

        used.add(unitSku);

        return {
          tenantId,
          inventoryItemId: inventoryItem.id,
          batchId: seedBatch.id,
          unitSku,
          status: InventoryUnitStatus.Available,
        };
      });

      await prisma.inventory_units.createMany({ data: newUnits });
    }

    // keep qty consistent
    await prisma.inventory_items.update({
      where: { id: inventoryItem.id },
      data: { availableQty: item.units, updatedAt: new Date() },
    });
  }

  console.log("✅ Inventory seeded");
}

async function pickOrCreateAvailableUnits(params: {
  tenantId: string;
  inventoryItemId: string;
  batchId: string;
  skuPrefix: string;
  qty: number;
}) {
  const { tenantId, inventoryItemId, batchId, skuPrefix, qty } = params;

  const available = await prisma.inventory_units.findMany({
    where: { tenantId, inventoryItemId, status: InventoryUnitStatus.Available },
    take: qty,
    orderBy: { createdAt: "asc" },
  });

  const short = qty - available.length;
  if (short <= 0) return available;

  // Find latest suffix so unitSku stays unique
  const latest = await prisma.inventory_units.findFirst({
    where: { tenantId, unitSku: { startsWith: `${skuPrefix}-` } },
    orderBy: { unitSku: "desc" },
    select: { unitSku: true },
  });

  let start = 0;
  if (latest?.unitSku) {
    const m = latest.unitSku.match(/-(\d{4})$/);
    if (m) start = Number(m[1]);
  }

  const newUnits = Array.from({ length: short }).map((_, i) => ({
    tenantId,
    inventoryItemId,
    batchId,
    unitSku: `${skuPrefix}-${String(start + i + 1).padStart(4, "0")}`,
    status: InventoryUnitStatus.Available,
  }));

  await prisma.inventory_units.createMany({ data: newUnits });

  return prisma.inventory_units.findMany({
    where: { tenantId, inventoryItemId, status: InventoryUnitStatus.Available },
    take: qty,
    orderBy: { createdAt: "asc" },
  });
}

async function createOrderWithStops(params: {
  tenantId: string;
  orderRef: string;
  createdAt: Date;
  status: OrderStatus;
  customerName: string;
  contactNumber: string;
  priceCents: number;
}) {
  const { tenantId, orderRef, createdAt, status, customerName, contactNumber, priceCents } = params;

  const internalRef = await generateInternalRef(tenantId, createdAt);

  const order = await prisma.transportOrder.create({
    data: {
      tenantId,
      customerRef: "CUST-DEMO",
      orderRef,
      internalRef,
      customerName,
      customerContactNumber: contactNumber,
      status,
      priceCents,
      currency: "SGD",
      notes: `Seed: ${status}`,
      createdAt,
      updatedAt: createdAt,
      doStatus: DoStatus.PENDING,
    },
  });

  const pickup = await prisma.stop.create({
    data: {
      tenantId,
      transportOrderId: order.id,
      type: StopType.PICKUP,
      sequence: 1,
      addressLine1: "10 Seed Warehouse Ave",
      city: "Singapore",
      postalCode: "408600",
      country: "SG",
      status: status === OrderStatus.Draft ? StopStatus.Pending : StopStatus.Completed,
      plannedAt: createdAt,
      completedAt: status === OrderStatus.Draft ? null : createdAt,
      createdAt,
      updatedAt: createdAt,
    },
  });

  const delivery = await prisma.stop.create({
    data: {
      tenantId,
      transportOrderId: order.id,
      type: StopType.DELIVERY,
      sequence: 2,
      addressLine1: "123 Demo Street",
      city: "Singapore",
      postalCode: "570123",
      country: "SG",
      status:
        status === OrderStatus.Delivered || status === OrderStatus.Closed
          ? StopStatus.Completed
          : status === OrderStatus.InTransit
          ? StopStatus.InProgress
          : StopStatus.Pending,
      plannedAt: createdAt,
      startedAt: status === OrderStatus.InTransit ? createdAt : null,
      completedAt: status === OrderStatus.Delivered || status === OrderStatus.Closed ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    },
  });

  if (status === OrderStatus.Delivered || status === OrderStatus.Closed) {
    await prisma.pod.create({
      data: {
        tenantId,
        stopId: delivery.id,
        status: PodStatus.Completed,
        signedBy: "Receiver A",
        signedAt: createdAt,
        photoUrl: "seed://pod/photo",
        createdAt,
        updatedAt: createdAt,
      },
    });
  }

  return { order, pickup, delivery };
}

async function attachItemsAndUnits(params: {
  tenantId: string;
  orderId: string;
  pickupStopId: string;
  deliveryStopId: string;
  tripId?: string | null;
  status: OrderStatus;
}) {
  const { tenantId, orderId, pickupStopId, deliveryStopId, tripId, status } = params;

  // One deterministic line item: Mattress
  const sku = "MAT-001";
  const inventoryItem = await prisma.inventory_items.findUniqueOrThrow({
    where: { tenantId_sku: { tenantId, sku } },
  });

  const batch = await prisma.inventory_batches.findFirstOrThrow({
    where: { tenantId, containerNumber: "SEED" },
    select: { id: true },
  });

  // keep simple: qty 2 for non-draft/cancelled orders
  const qty = 2;

  const orderItem = await prisma.transport_order_items.upsert({
    where: {
      transportOrderId_inventoryItemId: {
        transportOrderId: orderId,
        inventoryItemId: inventoryItem.id,
      },
    },
    update: { qty },
    create: {
      tenantId,
      transportOrderId: orderId,
      inventoryItemId: inventoryItem.id,
      qty,
      batchId: batch.id,
    },
  });

  const units = await pickOrCreateAvailableUnits({
    tenantId,
    inventoryItemId: inventoryItem.id,
    batchId: batch.id,
    skuPrefix: sku,
    qty,
  });

  const unitStatus =
    status === OrderStatus.Planned || status === OrderStatus.Confirmed
      ? InventoryUnitStatus.Reserved
      : status === OrderStatus.Dispatched || status === OrderStatus.InTransit
      ? InventoryUnitStatus.InTransit
      : status === OrderStatus.Delivered || status === OrderStatus.Closed
      ? InventoryUnitStatus.Delivered
      : status === OrderStatus.Cancelled
      ? InventoryUnitStatus.Available
      : InventoryUnitStatus.Available;

  for (const u of units) {
    await prisma.inventory_units.update({
      where: { id: u.id },
      data: {
        status: unitStatus,
        transportOrderId: orderId,
        tripId: tripId ?? null,
        stopId:
          unitStatus === InventoryUnitStatus.Reserved
            ? pickupStopId
            : unitStatus === InventoryUnitStatus.InTransit
            ? pickupStopId
            : unitStatus === InventoryUnitStatus.Delivered
            ? deliveryStopId
            : null,
      },
    });

    await prisma.transport_order_item_units.upsert({
      where: {
        transportOrderItemId_inventoryUnitId: {
          transportOrderItemId: orderItem.id,
          inventoryUnitId: u.id,
        },
      },
      update: {},
      create: {
        tenantId,
        transportOrderItemId: orderItem.id,
        inventoryUnitId: u.id,
      },
    });
  }
}

async function createTrip(params: {
  tenantId: string;
  status: TripStatus;
  driverId?: string | null;
  assignedDriverUserId?: string | null;
  vehicleId?: string | null;
  plannedStartAt: Date;
}) {
  const { tenantId, status, driverId, assignedDriverUserId, vehicleId, plannedStartAt } = params;

  const startedAt =
    status === TripStatus.Dispatched ||
    status === TripStatus.InTransit ||
    status === TripStatus.Delivered ||
    status === TripStatus.Closed
      ? plannedStartAt
      : null;

  const closedAt = status === TripStatus.Closed ? plannedStartAt : null;

  return prisma.trip.create({
    data: {
      tenantId,
      status,
      driverId: driverId ?? null,
      assignedDriverUserId: assignedDriverUserId ?? null,
      vehicleId: vehicleId ?? null,
      plannedStartAt,
      plannedEndAt: new Date(plannedStartAt.getTime() + 2 * 60 * 60 * 1000),
      startedAt,
      closedAt,
      acceptedVehicleNo: vehicleId ? "SEED-VEH" : null,
      acceptedTrailerNo: "TRAILER-SEED",
    },
  });
}

async function linkStopsToTrip(params: {
  tripId: string;
  stopIds: string[];
  startSequenceAt?: number;
}) {
  const { tripId, stopIds, startSequenceAt = 1 } = params;

  for (let i = 0; i < stopIds.length; i++) {
    await prisma.stop.update({
      where: { id: stopIds[i] },
      data: { tripId, sequence: startSequenceAt + i },
    });
  }
}

async function createInvoiceForClosedOrders(params: {
  tenantId: string;
  invoiceNo: string;
  orderIds: string[];
}) {
  const { tenantId, invoiceNo, orderIds } = params;

  const orders = await prisma.transportOrder.findMany({
    where: { tenantId, id: { in: orderIds } },
    orderBy: { createdAt: "asc" },
  });

  const subtotalCents = orders.reduce((sum, o) => sum + (o.priceCents ?? 0), 0);
  const taxCents = 0;
  const totalCents = subtotalCents + taxCents;

  const invoice = await prisma.invoice.upsert({
    where: { tenantId_invoiceNo: { tenantId, invoiceNo } },
    update: { subtotalCents, taxCents, totalCents },
    create: {
      tenantId,
      invoiceNo,
      customerName: orders[0]?.customerName ?? "Demo Customer",
      currency: "SGD",
      status: "Issued",
      subtotalCents,
      taxCents,
      totalCents,
      notes: "Seed invoice",
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Link orders + add line items (line items are not upserted; invoice upsert keeps id stable per invoiceNo)
  for (const o of orders) {
    await prisma.transportOrder.update({
      where: { id: o.id },
      data: { invoiceId: invoice.id },
    });

    await prisma.invoiceLineItem.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        description: `Delivery ${o.orderRef}`,
        qty: 1,
        unitPriceCents: o.priceCents ?? 0,
        amountCents: o.priceCents ?? 0,
        taxCode: "ZR",
        taxRate: 0,
        taxCents: 0,
      },
    });
  }

  return invoice;
}

/**
 * Wallet transactions (linked to order)
 * - Unique constraint: @@unique([tripId, transportOrderId])
 * - driverId is required, derived from trip.driverId
 */
async function upsertWalletTxForOrder(params: {
  tenantId: string;
  tripId: string;
  transportOrderId: string;
  stopId?: string | null;
  amountCents: number;
  type: string;
  description: string;
}) {
  const { tenantId, tripId, transportOrderId, stopId, amountCents, type, description } = params;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { driverId: true },
  });

  if (!trip?.driverId) return;

  const existing = await prisma.driverWalletTransaction.findFirst({
    where: { tripId, transportOrderId },
    select: { id: true },
  });

  if (existing) {
    await prisma.driverWalletTransaction.update({
      where: { id: existing.id },
      data: {
        tenantId,
        driverId: trip.driverId,
        stopId: stopId ?? null,
        amountCents,
        currency: "SGD",
        type,
        description,
      },
    });
  } else {
    await prisma.driverWalletTransaction.create({
      data: {
        tenantId,
        tripId,
        transportOrderId,
        stopId: stopId ?? null,
        driverId: trip.driverId,
        amountCents,
        currency: "SGD",
        type,
        description,
      },
    });
  }
}

async function main() {
  console.log("🌱 Starting demo seed...\n");

  // 1) Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME },
    create: { name: TENANT_NAME, slug: TENANT_SLUG },
  });

  console.log(`✅ Tenant: ${tenant.name} (${tenant.slug})`);

  // 2) Users + memberships
  const admin = await upsertUser(USERS.admin.email, USERS.admin.name);
  const customer = await upsertUser(USERS.customer.email, USERS.customer.name);

  await upsertMembership(tenant.id, admin.id, USERS.admin.role);
  await upsertMembership(tenant.id, customer.id, USERS.customer.role);

  // Drivers
  let primaryDriverUserId: string | null = null;
  let primaryDriverId: string | null = null;

  for (let i = 0; i < USERS.drivers.length; i++) {
    const d = USERS.drivers[i];
    const u = await upsertUser(d.email, d.name);

    await upsertMembership(tenant.id, u.id, Role.DRIVER);

    const drv = await upsertDriverRow({
      tenantId: tenant.id,
      userId: u.id,
      email: u.email,
      name: u.name ?? d.name,
      phone: `+6599${String(10000 + i).slice(-5)}`,
    });

    if (i === 0) {
      primaryDriverUserId = u.id;
      primaryDriverId = drv.id;
    }
  }

  console.log("✅ Users + memberships + drivers seeded");

  // 3) Vehicle
  const vehicle = await upsertVehicle(tenant.id, "SGX1234A");

  // 4) Inventory
  await seedInventory(tenant.id);

  // 5) Orders across statuses (Feb 2026)
  const base = new Date("2026-02-01T10:00:00.000Z");

  const statuses: { ref: string; status: OrderStatus; offsetMin: number; price: number }[] = [
    { ref: "ORD-DRAFT-001", status: OrderStatus.Draft, offsetMin: 0, price: 1200 },
    { ref: "ORD-CONF-001", status: OrderStatus.Confirmed, offsetMin: 2, price: 1800 },
    { ref: "ORD-PLAN-001", status: OrderStatus.Planned, offsetMin: 4, price: 2400 },
    { ref: "ORD-DISP-001", status: OrderStatus.Dispatched, offsetMin: 6, price: 2800 },
    { ref: "ORD-TRANS-001", status: OrderStatus.InTransit, offsetMin: 8, price: 3200 },
    { ref: "ORD-DELIV-001", status: OrderStatus.Delivered, offsetMin: 10, price: 3500 },
    { ref: "ORD-CLOSED-001", status: OrderStatus.Closed, offsetMin: 12, price: 4200 },
    { ref: "ORD-CANCEL-001", status: OrderStatus.Cancelled, offsetMin: 14, price: 1500 },
  ];

  const created: {
    status: OrderStatus;
    orderId: string;
    pickupStopId: string;
    deliveryStopId: string;
  }[] = [];

  for (const s of statuses) {
    const createdAt = new Date(base.getTime() + s.offsetMin * 60_000);
    const { order, pickup, delivery } = await createOrderWithStops({
      tenantId: tenant.id,
      orderRef: s.ref,
      createdAt,
      status: s.status,
      customerName: "Demo Trading Pte Ltd",
      contactNumber: "+6591111111",
      priceCents: s.price,
    });

    created.push({
      status: s.status,
      orderId: order.id,
      pickupStopId: pickup.id,
      deliveryStopId: delivery.id,
    });
  }

  console.log("✅ Orders + Stops seeded");

  // 6) Trips (3) + stop routing
  const tripPlanned = await createTrip({
    tenantId: tenant.id,
    status: TripStatus.Planned,
    driverId: primaryDriverId,
    assignedDriverUserId: primaryDriverUserId,
    vehicleId: vehicle.id,
    plannedStartAt: new Date(base.getTime() + 5 * 60_000),
  });

  const tripInTransit = await createTrip({
    tenantId: tenant.id,
    status: TripStatus.InTransit,
    driverId: primaryDriverId,
    assignedDriverUserId: primaryDriverUserId,
    vehicleId: vehicle.id,
    plannedStartAt: new Date(base.getTime() + 7 * 60_000),
  });

  const tripDelivered = await createTrip({
    tenantId: tenant.id,
    status: TripStatus.Delivered,
    driverId: primaryDriverId,
    assignedDriverUserId: primaryDriverUserId,
    vehicleId: vehicle.id,
    plannedStartAt: new Date(base.getTime() + 9 * 60_000),
  });

  const plannedOrders = created.filter((x) => x.status === OrderStatus.Planned);
  const movingOrders = created.filter(
    (x) => x.status === OrderStatus.Dispatched || x.status === OrderStatus.InTransit
  );
  const deliveredOrders = created.filter(
    (x) => x.status === OrderStatus.Delivered || x.status === OrderStatus.Closed
  );

  await linkStopsToTrip({
    tripId: tripPlanned.id,
    stopIds: plannedOrders.flatMap((o) => [o.pickupStopId, o.deliveryStopId]),
  });

  await linkStopsToTrip({
    tripId: tripInTransit.id,
    stopIds: movingOrders.flatMap((o) => [o.pickupStopId, o.deliveryStopId]),
  });

  await linkStopsToTrip({
    tripId: tripDelivered.id,
    stopIds: deliveredOrders.flatMap((o) => [o.pickupStopId, o.deliveryStopId]),
  });

  console.log("✅ Trips + stop routing seeded");

  // 7) Items + units + wallet (skip Draft/Cancelled)
  for (const o of created) {
    const tripId =
      o.status === OrderStatus.Planned
        ? tripPlanned.id
        : o.status === OrderStatus.Dispatched || o.status === OrderStatus.InTransit
        ? tripInTransit.id
        : o.status === OrderStatus.Delivered || o.status === OrderStatus.Closed
        ? tripDelivered.id
        : null;

    const shouldAttach = o.status !== OrderStatus.Draft && o.status !== OrderStatus.Cancelled;

    if (shouldAttach) {
      await attachItemsAndUnits({
        tenantId: tenant.id,
        orderId: o.orderId,
        pickupStopId: o.pickupStopId,
        deliveryStopId: o.deliveryStopId,
        tripId,
        status: o.status,
      });
    }

    // Wallet linked to order (transportOrderId)
    if (tripId) {
      const isDeliveredish = o.status === OrderStatus.Delivered || o.status === OrderStatus.Closed;
      const isMoving = o.status === OrderStatus.Dispatched || o.status === OrderStatus.InTransit;

      if (isMoving) {
        await upsertWalletTxForOrder({
          tenantId: tenant.id,
          tripId,
          transportOrderId: o.orderId,
          stopId: o.pickupStopId,
          amountCents: -500,
          type: "FUEL",
          description: `Fuel / ops cost (${o.status})`,
        });
      }

      if (isDeliveredish) {
        await upsertWalletTxForOrder({
          tenantId: tenant.id,
          tripId,
          transportOrderId: o.orderId,
          stopId: o.deliveryStopId,
          amountCents: 1800,
          type: "PAYOUT",
          description: `Delivery payout`,
        });
      }
    }
  }

  console.log("✅ Order items + inventory units + wallet seeded");

  // 8) Invoice for Closed orders
  const closedOrderIds = created.filter((x) => x.status === OrderStatus.Closed).map((x) => x.orderId);
  if (closedOrderIds.length) {
    await createInvoiceForClosedOrders({
      tenantId: tenant.id,
      invoiceNo: "INV-2026-0001",
      orderIds: closedOrderIds,
    });
    console.log("✅ Invoice seeded for Closed orders");
  }

  console.log("\n🎉 Seed complete!");
  console.log(`Tenant slug: ${TENANT_SLUG}`);
  console.log("Auth UIDs are linked via users.authUserId ✅");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
