-- Link container/seal trip photos to stable JobItem container rows.
-- ON DELETE SET NULL preserves historical documents when Ops removes an item.

ALTER TABLE "trip_documents"
  ADD COLUMN "jobItemId" TEXT;

ALTER TABLE "trip_documents"
  ADD CONSTRAINT "trip_documents_jobItemId_fkey"
  FOREIGN KEY ("jobItemId") REFERENCES "job_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "trip_documents_tenantId_tripId_jobItemId_type_idx"
  ON "trip_documents"("tenantId", "tripId", "jobItemId", "type");
