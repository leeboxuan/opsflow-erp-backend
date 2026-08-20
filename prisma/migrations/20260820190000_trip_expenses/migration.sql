-- Additive Phase 2: structured trip expenses, receipt attachments, and expense events.
-- Do not backfill amounts from legacy receipt files.
-- Safe order: see prisma/migrations/README-phase2-trip-expenses.md
-- New tables only — no collision preflight required for empty tables.
-- Unique on (tenantId, storageKey) is safe on create (no existing rows).

CREATE TYPE "TripExpenseCategory" AS ENUM (
  'PARKING',
  'TOLL',
  'FUEL',
  'PORT_FEE',
  'ERP_CHARGE',
  'CASH_CARD',
  'MEAL',
  'MISCELLANEOUS',
  'OTHER'
);

CREATE TYPE "TripExpensePaymentMethod" AS ENUM (
  'COMPANY_EPAYMENT',
  'DRIVER_PAID',
  'COMPANY_CASH',
  'OTHER'
);

CREATE TYPE "TripExpenseReviewStatus" AS ENUM (
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_CLARIFICATION'
);

CREATE TYPE "TripExpenseReimbursementStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'PAID'
);

CREATE TYPE "TripExpenseEventAction" AS ENUM (
  'SUBMITTED',
  'ATTACHMENT_ADDED',
  'UPDATED',
  'RESUBMITTED',
  'CLARIFICATION_REQUESTED',
  'APPROVED',
  'REJECTED',
  'REVIEWER_CORRECTED',
  'REIMBURSEMENT_MARKED_PAID',
  'REIMBURSEMENT_REOPENED'
);

CREATE TABLE "trip_expenses" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "submittedByDriverId" TEXT,
  "category" "TripExpenseCategory" NOT NULL,
  "paymentMethod" "TripExpensePaymentMethod" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "transactionDate" DATE NOT NULL,
  "remarks" TEXT,
  "reviewStatus" "TripExpenseReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "reimbursementStatus" "TripExpenseReimbursementStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "reimbursedAt" TIMESTAMP(3),
  "reimbursedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trip_expense_attachments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER,
  "uploadedByUserId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "trip_expense_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trip_expense_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" "TripExpenseEventAction" NOT NULL,
  "previousStatus" "TripExpenseReviewStatus",
  "newStatus" "TripExpenseReviewStatus",
  "reason" TEXT,
  "changedFieldsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trip_expense_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_expenses_tenantId_reviewStatus_createdAt_idx"
  ON "trip_expenses"("tenantId", "reviewStatus", "createdAt");
CREATE INDEX "trip_expenses_tenantId_reimbursementStatus_createdAt_idx"
  ON "trip_expenses"("tenantId", "reimbursementStatus", "createdAt");
CREATE INDEX "trip_expenses_tenantId_tripId_createdAt_idx"
  ON "trip_expenses"("tenantId", "tripId", "createdAt");
CREATE INDEX "trip_expenses_tenantId_jobId_createdAt_idx"
  ON "trip_expenses"("tenantId", "jobId", "createdAt");
CREATE INDEX "trip_expenses_tenantId_submittedByUserId_createdAt_idx"
  ON "trip_expenses"("tenantId", "submittedByUserId", "createdAt");
CREATE INDEX "trip_expenses_tenantId_transactionDate_idx"
  ON "trip_expenses"("tenantId", "transactionDate");

CREATE INDEX "trip_expense_attachments_tenantId_expenseId_isActive_idx"
  ON "trip_expense_attachments"("tenantId", "expenseId", "isActive");
CREATE UNIQUE INDEX "trip_expense_attachments_tenantId_storageKey_key"
  ON "trip_expense_attachments"("tenantId", "storageKey");

CREATE INDEX "trip_expense_events_tenantId_expenseId_createdAt_idx"
  ON "trip_expense_events"("tenantId", "expenseId", "createdAt");

ALTER TABLE "trip_expenses"
  ADD CONSTRAINT "trip_expenses_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expenses"
  ADD CONSTRAINT "trip_expenses_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expenses"
  ADD CONSTRAINT "trip_expenses_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expenses"
  ADD CONSTRAINT "trip_expenses_submittedByUserId_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses"
  ADD CONSTRAINT "trip_expenses_submittedByDriverId_fkey"
  FOREIGN KEY ("submittedByDriverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip_expenses"
  ADD CONSTRAINT "trip_expenses_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip_expenses"
  ADD CONSTRAINT "trip_expenses_reimbursedByUserId_fkey"
  FOREIGN KEY ("reimbursedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trip_expense_attachments"
  ADD CONSTRAINT "trip_expense_attachments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expense_attachments"
  ADD CONSTRAINT "trip_expense_attachments_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "trip_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expense_attachments"
  ADD CONSTRAINT "trip_expense_attachments_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trip_expense_events"
  ADD CONSTRAINT "trip_expense_events_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expense_events"
  ADD CONSTRAINT "trip_expense_events_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "trip_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expense_events"
  ADD CONSTRAINT "trip_expense_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
