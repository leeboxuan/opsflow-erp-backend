-- CreateTable
CREATE TABLE "trip_job_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "jobItemId" TEXT NOT NULL,
    "containerNumberSnapshot" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_job_items_tenantId_tripId_idx" ON "trip_job_items"("tenantId", "tripId");

-- CreateIndex
CREATE INDEX "trip_job_items_tenantId_jobItemId_idx" ON "trip_job_items"("tenantId", "jobItemId");

-- CreateIndex
CREATE INDEX "trip_job_items_tripId_idx" ON "trip_job_items"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "trip_job_items_tenantId_tripId_jobItemId_key" ON "trip_job_items"("tenantId", "tripId", "jobItemId");

-- AddForeignKey
ALTER TABLE "trip_job_items" ADD CONSTRAINT "trip_job_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_job_items" ADD CONSTRAINT "trip_job_items_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_job_items" ADD CONSTRAINT "trip_job_items_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "job_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_job_items" ADD CONSTRAINT "trip_job_items_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
