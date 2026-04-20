-- Add invoice handoff marker on ops jobs.
ALTER TABLE "jobs"
ADD COLUMN "invoiceReadyAt" TIMESTAMP(3);
