-- Per-user read state for shared TENANT/ROLE notifications.

CREATE TABLE "notification_recipients" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_recipients_notificationId_userId_key"
    ON "notification_recipients"("notificationId", "userId");

CREATE INDEX "notification_recipients_tenantId_userId_readAt_createdAt_idx"
    ON "notification_recipients"("tenantId", "userId", "readAt", "createdAt");

CREATE INDEX "notification_recipients_tenantId_userId_createdAt_idx"
    ON "notification_recipients"("tenantId", "userId", "createdAt");

ALTER TABLE "notification_recipients"
    ADD CONSTRAINT "notification_recipients_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "notifications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "notifications_tenantId_userId_readAt_createdAt_idx";
DROP INDEX IF EXISTS "notifications_tenantId_role_readAt_createdAt_idx";

CREATE INDEX "notifications_tenantId_userId_createdAt_idx"
    ON "notifications"("tenantId", "userId", "createdAt");

CREATE INDEX "notifications_tenantId_role_createdAt_idx"
    ON "notifications"("tenantId", "role", "createdAt");

ALTER TABLE "notifications" DROP COLUMN "readAt";
