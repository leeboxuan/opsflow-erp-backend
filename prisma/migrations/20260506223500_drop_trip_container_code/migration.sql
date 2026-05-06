-- containerCode existed only if an older revision added it; fresh DBs skip backfill/drop safely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'trips'
      AND a.attname = 'containerCode'
      AND NOT a.attisdropped
      AND a.attnum > 0
  ) THEN
    UPDATE "trips"
    SET "containerNumber" = "containerCode"
    WHERE "containerNumber" IS NULL
      AND "containerCode" IS NOT NULL;

    ALTER TABLE "trips"
    DROP COLUMN "containerCode";
  END IF;
END $$;
