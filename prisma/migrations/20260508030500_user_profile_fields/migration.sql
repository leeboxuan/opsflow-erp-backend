-- Add user-level profile fields for self-service profile and avatar.
ALTER TABLE "users"
ADD COLUMN "displayName" TEXT,
ADD COLUMN "avatarKey" TEXT,
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);
