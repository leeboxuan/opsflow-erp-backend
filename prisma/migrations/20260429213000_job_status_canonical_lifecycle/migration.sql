-- Canonicalize JobStatus values and backfill lifecycle state.

CREATE TYPE "JobStatus_new" AS ENUM (
  'ONGOING',
  'READY_FOR_INVOICE',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "jobs"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "jobs"
ALTER COLUMN "status" TYPE "JobStatus_new"
USING (
  CASE "status"::text
    WHEN 'Draft' THEN 'ONGOING'
    WHEN 'Assigned' THEN 'ONGOING'
    WHEN 'InProgress' THEN 'ONGOING'
    WHEN 'PendingDepot' THEN 'ONGOING'
    WHEN 'Completed' THEN 'COMPLETED'
    WHEN 'Cancelled' THEN 'CANCELLED'
    ELSE 'ONGOING'
  END
)::"JobStatus_new";

DROP TYPE "JobStatus";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";

ALTER TABLE "jobs"
ALTER COLUMN "status" SET DEFAULT 'ONGOING'::"JobStatus";

-- Promote ongoing jobs to READY_FOR_INVOICE when all non-cancelled trips are DONE.
UPDATE "jobs" j
SET "status" = 'READY_FOR_INVOICE'::"JobStatus"
WHERE j."status" = 'ONGOING'::"JobStatus"
  AND EXISTS (
    SELECT 1
    FROM "trips" t_exist
    WHERE t_exist."jobId" = j."id"
      AND t_exist."status"::text <> 'CANCELLED'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "trips" t_open
    WHERE t_open."jobId" = j."id"
      AND t_open."status"::text <> 'CANCELLED'
      AND t_open."status"::text <> 'DONE'
  );
