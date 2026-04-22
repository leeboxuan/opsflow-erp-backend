ALTER TABLE "master_logistics_locations"
  ADD COLUMN "label" TEXT;

CREATE UNIQUE INDEX "master_logistics_locations_code_key"
ON "master_logistics_locations"("code");
