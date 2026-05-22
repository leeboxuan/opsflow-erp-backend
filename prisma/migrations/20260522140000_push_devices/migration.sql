-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android', 'unknown');

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL DEFAULT 'unknown',
    "expoPushToken" TEXT NOT NULL,
    "deviceId" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_expoPushToken_key" ON "push_devices"("expoPushToken");

-- CreateIndex
CREATE INDEX "push_devices_tenantId_userId_idx" ON "push_devices"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "push_devices_disabledAt_idx" ON "push_devices"("disabledAt");

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
