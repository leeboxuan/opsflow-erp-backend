ALTER TABLE "job_documents"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "trip_documents"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "signedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "tripSequence" INTEGER,
  ADD COLUMN IF NOT EXISTS "displayTitle" TEXT;

UPDATE "job_documents" SET "isActive" = true WHERE "isActive" IS DISTINCT FROM true;
UPDATE "trip_documents" SET "isActive" = true WHERE "isActive" IS DISTINCT FROM true;

-- Normalize old signature naming to new canonical POD_SIGNATURE
-- after enum value exists in a prior committed migration.
UPDATE "trip_documents"
SET "type" = 'POD_SIGNATURE'
WHERE "type" = 'SIGNATURE';
