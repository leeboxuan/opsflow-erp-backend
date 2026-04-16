ALTER TABLE "dhc_reference_items"
ADD COLUMN "yardDepot" TEXT,
ADD COLUMN "oldRateCents" INTEGER,
ADD COLUMN "newRateCents" INTEGER,
ADD COLUMN "software" TEXT,
ADD COLUMN "operatorCode" TEXT,
ADD COLUMN "operatorName" TEXT,
ADD COLUMN "effectiveDate" TIMESTAMP(3);
