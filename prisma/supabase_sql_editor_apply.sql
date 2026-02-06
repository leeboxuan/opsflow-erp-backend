-- =============================================================================
-- Run this in Supabase → SQL Editor (one block or step-by-step).
-- Idempotent where possible: safe to run more than once.
-- If a statement errors (e.g. "already exists"), skip that statement and continue.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) users.authUserId (login mapping: JWT sub → internal user)
-- -----------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authUserId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_authUserId_key" ON "users"("authUserId");
CREATE INDEX IF NOT EXISTS "users_authUserId_idx" ON "users"("authUserId");

-- -----------------------------------------------------------------------------
-- 2) inventory_items.unit (display label e.g. "pcs", "box")
-- -----------------------------------------------------------------------------
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "unit" TEXT;

-- -----------------------------------------------------------------------------
-- 3) inventory_batch_items table (Stock In: batch + item + qty)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "inventory_batch_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_batch_items_batchId_inventoryItemId_key"
  ON "inventory_batch_items"("batchId", "inventoryItemId");
CREATE INDEX IF NOT EXISTS "inventory_batch_items_tenantId_batchId_idx"
  ON "inventory_batch_items"("tenantId", "batchId");

-- Run these only if the table was just created (skip if you get "already exists"):
ALTER TABLE "inventory_batch_items" ADD CONSTRAINT "inventory_batch_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_batch_items" ADD CONSTRAINT "inventory_batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "inventory_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_batch_items" ADD CONSTRAINT "inventory_batch_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 4) InventoryBatchStatus: add 'Draft' if your enum only has Open/Completed/Cancelled
-- (Only run if you get "invalid input value for enum" for Draft.)
-- -----------------------------------------------------------------------------
-- ALTER TYPE "InventoryBatchStatus" ADD VALUE IF NOT EXISTS 'Draft';
-- Then set default for new batches (optional):
-- ALTER TABLE "inventory_batches" ALTER COLUMN "status" SET DEFAULT 'Draft';

-- -----------------------------------------------------------------------------
-- 5) Stops: allow multiple stops per order (drop unique, keep index)
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS "stops_tenantId_transportOrderId_key";
CREATE INDEX IF NOT EXISTS "stops_tenantId_transportOrderId_idx" ON "stops"("tenantId", "transportOrderId");
