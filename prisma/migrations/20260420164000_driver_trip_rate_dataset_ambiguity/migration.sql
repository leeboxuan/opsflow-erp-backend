-- Driver trucking rates: preserve ambiguous/multiple amount options in dataset
ALTER TABLE "driver_trip_rate_masters"
ALTER COLUMN "amountCents" DROP NOT NULL;

ALTER TABLE "driver_trip_rate_masters"
ADD COLUMN "rawRateText" TEXT,
ADD COLUMN "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hasMultipleRates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rateOptionsJson" JSONB,
ADD COLUMN "defaultRateOptionIndex" INTEGER;
