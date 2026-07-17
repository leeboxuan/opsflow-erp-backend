-- Job-level pickup reference/description and shipping details for all job types.
-- Trip driver remarks + container/seal photo document types.

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "pickupReference" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "carrierName" TEXT,
  ADD COLUMN IF NOT EXISTS "voyage" TEXT,
  ADD COLUMN IF NOT EXISTS "shipper" TEXT;

ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "driverRemarks" TEXT;

-- Prisma Postgres enums: add values for driver container/seal photos.
ALTER TYPE "TripDocumentType" ADD VALUE IF NOT EXISTS 'CONTAINER_PHOTO';
ALTER TYPE "TripDocumentType" ADD VALUE IF NOT EXISTS 'SEAL_PHOTO';
