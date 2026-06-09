-- CreateEnum
CREATE TYPE "CollectionType" AS ENUM ('EMPTY', 'LOADED');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "collectionType" "CollectionType";
