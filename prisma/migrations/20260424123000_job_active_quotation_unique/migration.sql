-- Enforce exactly one active QUOTATION per job at DB level.
-- Historical/inactive quotations remain allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "job_documents_active_quotation_per_job_unique"
ON "job_documents"("tenantId", "jobId", "type")
WHERE "isActive" = true AND "type" = 'QUOTATION';
