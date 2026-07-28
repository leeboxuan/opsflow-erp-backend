-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users"("username");
