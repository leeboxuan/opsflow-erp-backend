-- Preserve ambiguous multi-value rates as manual-amount rows.
ALTER TABLE "customer_quotation_items"
ALTER COLUMN "rateCents" DROP NOT NULL,
ADD COLUMN "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rawRateText" TEXT;

ALTER TABLE "driver_payout_items"
ALTER COLUMN "rateCents" DROP NOT NULL,
ADD COLUMN "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rawRateText" TEXT;

ALTER TABLE "customer_quotation_rate_lines"
ALTER COLUMN "rateCents" DROP NOT NULL,
ADD COLUMN "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rawRateText" TEXT;

ALTER TABLE "customer_rate_master_lines"
ALTER COLUMN "rateCents" DROP NOT NULL,
ADD COLUMN "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rawRateText" TEXT;
