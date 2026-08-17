-- Idempotency records for onboarding create/retry safety.
CREATE TYPE "IdempotencyRecordStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE IF NOT EXISTS "idempotency_records" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "scope" VARCHAR(64) NOT NULL,
  "operationKey" VARCHAR(128) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "status" "IdempotencyRecordStatus" NOT NULL DEFAULT 'PENDING',
  "resourceType" VARCHAR(64),
  "resourceId" VARCHAR(128),
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_records_tenantId_scope_operationKey_key"
  ON "idempotency_records"("tenantId", "scope", "operationKey");

CREATE INDEX IF NOT EXISTS "idempotency_records_tenantId_resourceType_resourceId_idx"
  ON "idempotency_records"("tenantId", "resourceType", "resourceId");

CREATE INDEX IF NOT EXISTS "idempotency_records_tenantId_status_claimedAt_idx"
  ON "idempotency_records"("tenantId", "status", "claimedAt");

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
