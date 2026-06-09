-- Add COLLECTION job type
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'COLLECTION';

-- Container cargo: optional seal number per job item
ALTER TABLE "job_items" ADD COLUMN IF NOT EXISTS "sealNo" TEXT;

-- Qty optional for container-style cargo lines
ALTER TABLE "job_items" ALTER COLUMN "qty" DROP NOT NULL;
ALTER TABLE "job_items" ALTER COLUMN "qty" DROP DEFAULT;
