-- DB-level singleton protection for active single-file document types.
-- Multi-file document types (OTHER, POD_PHOTO) intentionally remain unrestricted.

-- Job-level: only one active QUOTATION per job.
CREATE UNIQUE INDEX IF NOT EXISTS "job_documents_active_quotation_per_job_unique"
ON "job_documents"("tenantId", "jobId", "type")
WHERE "isActive" = true AND "type" = 'QUOTATION';

-- Trip-level: only one active PICKUP_DO per trip.
CREATE UNIQUE INDEX IF NOT EXISTS "trip_documents_active_pickup_do_per_trip_unique"
ON "trip_documents"("tenantId", "tripId", "type")
WHERE "isActive" = true AND "type" = 'PICKUP_DO';

-- Trip-level: only one active DELIVERY_DO per trip.
CREATE UNIQUE INDEX IF NOT EXISTS "trip_documents_active_delivery_do_per_trip_unique"
ON "trip_documents"("tenantId", "tripId", "type")
WHERE "isActive" = true AND "type" = 'DELIVERY_DO';

-- Trip-level: only one active POD_SIGNATURE per trip.
CREATE UNIQUE INDEX IF NOT EXISTS "trip_documents_active_pod_signature_per_trip_unique"
ON "trip_documents"("tenantId", "tripId", "type")
WHERE "isActive" = true AND "type" = 'POD_SIGNATURE';
