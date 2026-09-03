-- Additive only: optional operating-hours display text on Singapore depot masters.
-- Nullable — existing rows keep null; no backfill of jobs or operational records.
-- Does not drop columns, delete rows, recreate tables, or alter depot codes.

ALTER TABLE "master_singapore_depots" ADD COLUMN "operatingHoursSummary" TEXT;
