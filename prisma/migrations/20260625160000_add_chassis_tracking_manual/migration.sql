-- Phase 1 chassis tracking (idempotent manual migration).
-- Safe to re-run: preserves existing gps_devices / gps_positions rows.

-- CreateTable
CREATE TABLE IF NOT EXISTS "chassis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chassisNo" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chassis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "chassis_tenantId_chassisNo_key"
ON "chassis"("tenantId", "chassisNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chassis_tenantId_idx"
ON "chassis"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chassis_tenantId_status_idx"
ON "chassis"("tenantId", "status");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chassis_tenantId_fkey'
  ) THEN
    ALTER TABLE "chassis"
      ADD CONSTRAINT "chassis_tenantId_fkey"
      FOREIGN KEY ("tenantId")
      REFERENCES "tenants"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "gps_devices"
  ADD COLUMN IF NOT EXISTS "chassisId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "gps_devices_tenantId_chassisId_idx"
ON "gps_devices"("tenantId", "chassisId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'gps_devices_chassisId_fkey'
  ) THEN
    ALTER TABLE "gps_devices"
      ADD CONSTRAINT "gps_devices_chassisId_fkey"
      FOREIGN KEY ("chassisId")
      REFERENCES "chassis"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "gps_positions"
  ADD COLUMN IF NOT EXISTS "chassisId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "gps_positions_chassisId_recordedAt_idx"
ON "gps_positions"("chassisId", "recordedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "gps_positions_tenantId_chassisId_recordedAt_idx"
ON "gps_positions"("tenantId", "chassisId", "recordedAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'gps_positions_chassisId_fkey'
  ) THEN
    ALTER TABLE "gps_positions"
      ADD CONSTRAINT "gps_positions_chassisId_fkey"
      FOREIGN KEY ("chassisId")
      REFERENCES "chassis"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
