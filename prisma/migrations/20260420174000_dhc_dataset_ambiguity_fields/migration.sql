-- DHC dataset rows: preserve ambiguous/multiple amount options
ALTER TABLE "depot_handling_references"
ADD COLUMN "rawRateText" TEXT,
ADD COLUMN "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hasMultipleRates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rateOptionsJson" JSONB,
ADD COLUMN "defaultRateOptionIndex" INTEGER;
