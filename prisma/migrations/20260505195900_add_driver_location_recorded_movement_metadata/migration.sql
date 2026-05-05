ALTER TABLE "driver_location_latest"
ADD COLUMN "recordedAt" TIMESTAMP(3),
ADD COLUMN "lastMovedAt" TIMESTAMP(3),
ADD COLUMN "lastMovedLat" DOUBLE PRECISION,
ADD COLUMN "lastMovedLng" DOUBLE PRECISION;

UPDATE "driver_location_latest"
SET "recordedAt" = "capturedAt"
WHERE "recordedAt" IS NULL;
