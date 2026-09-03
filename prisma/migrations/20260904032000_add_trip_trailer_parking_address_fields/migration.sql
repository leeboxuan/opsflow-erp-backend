-- Additive Places fields for trip trailer parking. Legacy code + lat/lng kept.
-- SOURCE ONLY — DO NOT APPLY from this agent session.

ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "trailerParkingAddress1" TEXT;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "trailerParkingAddress2" TEXT;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "trailerParkingPostal" TEXT;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "trailerParkingPlaceId" TEXT;
