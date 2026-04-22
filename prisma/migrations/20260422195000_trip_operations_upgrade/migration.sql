-- Trip operations upgrade: logistics location master, structured route snapshots,
-- trip payout lines, and DELIVERY_DO trip document support.

CREATE TYPE "LogisticsLocationType" AS ENUM ('PORT', 'DEPOT');

ALTER TYPE "TripDocumentType" ADD VALUE 'DELIVERY_DO';

CREATE TABLE "master_logistics_locations" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "LogisticsLocationType" NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "postalCode" TEXT,
  "country" TEXT NOT NULL DEFAULT 'SG',
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "placeId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "master_logistics_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_logistics_locations_type_code_key"
ON "master_logistics_locations"("type", "code");

CREATE INDEX "master_logistics_locations_type_isActive_idx"
ON "master_logistics_locations"("type", "isActive");

ALTER TABLE "trips"
  ADD COLUMN "originLocationId" TEXT,
  ADD COLUMN "originLabel" TEXT,
  ADD COLUMN "originAddressLine1" TEXT,
  ADD COLUMN "originAddressLine2" TEXT,
  ADD COLUMN "originPostalCode" TEXT,
  ADD COLUMN "originCountry" TEXT,
  ADD COLUMN "originLat" DOUBLE PRECISION,
  ADD COLUMN "originLng" DOUBLE PRECISION,
  ADD COLUMN "originPlaceId" TEXT,
  ADD COLUMN "destinationLocationId" TEXT,
  ADD COLUMN "destinationLabel" TEXT,
  ADD COLUMN "destinationAddressLine1" TEXT,
  ADD COLUMN "destinationAddressLine2" TEXT,
  ADD COLUMN "destinationPostalCode" TEXT,
  ADD COLUMN "destinationCountry" TEXT,
  ADD COLUMN "destinationLat" DOUBLE PRECISION,
  ADD COLUMN "destinationLng" DOUBLE PRECISION,
  ADD COLUMN "destinationPlaceId" TEXT;

CREATE TABLE "trip_payout_lines" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "sourceType" "JobChargeSourceType" NOT NULL,
  "payoutItemId" TEXT,
  "earningRateMasterId" TEXT,
  "code" TEXT,
  "label" TEXT NOT NULL,
  "amountCents" INTEGER,
  "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
  "isSelectableForTripEarning" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trip_payout_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_payout_lines_tenantId_tripId_idx"
ON "trip_payout_lines"("tenantId", "tripId");

CREATE INDEX "trip_payout_lines_tenantId_payoutItemId_idx"
ON "trip_payout_lines"("tenantId", "payoutItemId");

CREATE INDEX "trip_payout_lines_tenantId_earningRateMasterId_idx"
ON "trip_payout_lines"("tenantId", "earningRateMasterId");

ALTER TABLE "trip_payout_lines"
  ADD CONSTRAINT "trip_payout_lines_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_payout_lines"
  ADD CONSTRAINT "trip_payout_lines_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_payout_lines"
  ADD CONSTRAINT "trip_payout_lines_payoutItemId_fkey"
  FOREIGN KEY ("payoutItemId") REFERENCES "driver_payout_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trip_payout_lines"
  ADD CONSTRAINT "trip_payout_lines_earningRateMasterId_fkey"
  FOREIGN KEY ("earningRateMasterId") REFERENCES "master_rate_dataset_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
