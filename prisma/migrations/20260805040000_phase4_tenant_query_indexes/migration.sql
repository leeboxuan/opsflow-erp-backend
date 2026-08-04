-- Phase 4: tenant-scoped query indexes for dashboard / invoice job lookups
CREATE INDEX IF NOT EXISTS "jobs_tenantId_createdAt_idx" ON "jobs"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "jobs_tenantId_updatedAt_idx" ON "jobs"("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "invoices_tenantId_sourceJobId_idx" ON "invoices"("tenantId", "sourceJobId");
