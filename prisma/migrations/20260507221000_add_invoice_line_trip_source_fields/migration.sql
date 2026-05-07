ALTER TABLE "invoice_line_items"
ADD COLUMN IF NOT EXISTS "sourceTripId" TEXT,
ADD COLUMN IF NOT EXISTS "tripDisplayRefSnapshot" TEXT;
