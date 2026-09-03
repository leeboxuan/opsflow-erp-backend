-- Additive only: JobItem.containerSize for IMPORT/EXPORT/COLLECTION cargo.
-- Nullable — existing Draft JobItems keep null without backfill.
-- Does not recreate tables, drop columns, or change statuses/IDs/links.

CREATE TYPE "ContainerSize" AS ENUM ('20ft', '40ft', '45ft');

ALTER TABLE "job_items" ADD COLUMN "containerSize" "ContainerSize";
