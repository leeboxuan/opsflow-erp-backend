-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('USER', 'ROLE', 'TENANT');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'DANGER');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "role" "Role",
    "audience" "NotificationAudience" NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "entityType" TEXT,
    "entityId" TEXT,
    "jobId" TEXT,
    "tripId" TEXT,
    "driverUserId" TEXT,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "notifications"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_createdAt_idx" ON "notifications"("tenantId", "userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_role_readAt_createdAt_idx" ON "notifications"("tenantId", "role", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_type_entityId_idx" ON "notifications"("tenantId", "type", "entityId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
