ALTER TYPE "TripDocumentType" ADD VALUE 'OFFLOADING_PHOTO';

ALTER TABLE "trip_documents"
  ADD COLUMN "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isSigned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "signedAt" TIMESTAMP(3),
  ADD COLUMN "signedByName" TEXT;

CREATE TABLE "trip_document_requirements" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "type" "TripDocumentType" NOT NULL,
  "label" TEXT NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
  "minCount" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trip_document_requirements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_document_requirements_tenantId_tripId_idx"
ON "trip_document_requirements"("tenantId", "tripId");

ALTER TABLE "trip_document_requirements"
  ADD CONSTRAINT "trip_document_requirements_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_document_requirements"
  ADD CONSTRAINT "trip_document_requirements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
