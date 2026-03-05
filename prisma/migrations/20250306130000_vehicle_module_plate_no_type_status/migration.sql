-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('VAN', 'TRUCK_10FT', 'TRUCK_14FT', 'TRUCK_24FT', 'TRAILER', 'PRIME_MOVER', 'LORRY_CRANE', 'MOTORCYCLE');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- AlterTable: Rename vehicleNumber to plateNo (preserve data)
ALTER TABLE "vehicles" RENAME COLUMN "vehicleNumber" TO "plateNo";

-- AlterTable: Add type (required, default VAN for existing rows)
ALTER TABLE "vehicles" ADD COLUMN "type" "VehicleType" NOT NULL DEFAULT 'VAN';

-- AlterTable: Add status (required, default ACTIVE)
ALTER TABLE "vehicles" ADD COLUMN "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable: Add driverId (optional FK to users)
ALTER TABLE "vehicles" ADD COLUMN "driverId" TEXT;

-- Drop old unique constraint (name may be vehicles_tenantId_vehicleNumber_key)
ALTER TABLE "vehicles" DROP CONSTRAINT IF EXISTS "vehicles_tenantId_vehicleNumber_key";

-- Add new unique constraint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenantId_plateNo_key" UNIQUE ("tenantId", "plateNo");

-- Add FK for driverId
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (optional, for list filters)
CREATE INDEX "vehicles_tenantId_status_idx" ON "vehicles"("tenantId", "status");
CREATE INDEX "vehicles_tenantId_type_idx" ON "vehicles"("tenantId", "type");
CREATE INDEX "vehicles_tenantId_driverId_idx" ON "vehicles"("tenantId", "driverId");
