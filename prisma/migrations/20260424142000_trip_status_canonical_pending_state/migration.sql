-- Canonical trip lifecycle statuses + secondary pending state.
-- Safely remap existing values while preserving intent.

CREATE TYPE "TripPendingState" AS ENUM ('NONE', 'PENDING_AT_PORT', 'PENDING_AT_DEPOT');

ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "pendingState" "TripPendingState" NOT NULL DEFAULT 'NONE';

-- Rebuild TripStatus enum to support many-to-one remap (Planned/Dispatched -> PUBLISHED).
ALTER TYPE "TripStatus" RENAME TO "TripStatus_old";

CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ONGOING', 'COMPLETED', 'DONE', 'CANCELLED');

ALTER TABLE "trips"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "trips"
  ALTER COLUMN "status" TYPE "TripStatus"
  USING (
    CASE "status"::text
      WHEN 'Draft' THEN 'DRAFT'
      WHEN 'Planned' THEN 'PUBLISHED'
      WHEN 'Dispatched' THEN 'PUBLISHED'
      WHEN 'InTransit' THEN 'ONGOING'
      WHEN 'Delivered' THEN 'COMPLETED'
      WHEN 'Closed' THEN 'DONE'
      WHEN 'Cancelled' THEN 'CANCELLED'
      ELSE 'DRAFT'
    END
  )::"TripStatus";

ALTER TABLE "trips"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "TripStatus_old";

-- Keep pending state valid for terminal/draft statuses.
UPDATE "trips"
SET "pendingState" = 'NONE'
WHERE "status" IN ('DRAFT', 'COMPLETED', 'DONE', 'CANCELLED');
