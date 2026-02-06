-- Add optional display unit label (e.g. "pcs", "box") to inventory_items for mobile
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "unit" TEXT;
