-- CreateTable
CREATE TABLE "fleet_vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plateNo" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "vehicleDescription" TEXT,
    "driverId" TEXT,
    "roadTaxExpiryDate" TIMESTAMP(3),
    "lastServicingDate" TIMESTAMP(3),
    "coeExpiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_vehicles_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "drivers"
ADD COLUMN "assignedFleetVehicleId" TEXT;

-- AlterTable
ALTER TABLE "jobs"
ADD COLUMN "assignedFleetVehicleId" TEXT;

-- AlterTable
ALTER TABLE "trips"
ADD COLUMN "fleetVehicleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicles_tenantId_plateNo_key" ON "fleet_vehicles"("tenantId", "plateNo");

-- CreateIndex
CREATE INDEX "fleet_vehicles_tenantId_idx" ON "fleet_vehicles"("tenantId");

-- CreateIndex
CREATE INDEX "fleet_vehicles_tenantId_status_idx" ON "fleet_vehicles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "fleet_vehicles_tenantId_type_idx" ON "fleet_vehicles"("tenantId", "type");

-- CreateIndex
CREATE INDEX "fleet_vehicles_tenantId_driverId_idx" ON "fleet_vehicles"("tenantId", "driverId");

-- CreateIndex
CREATE INDEX "drivers_tenantId_assignedFleetVehicleId_idx" ON "drivers"("tenantId", "assignedFleetVehicleId");

-- CreateIndex
CREATE INDEX "jobs_tenantId_assignedFleetVehicleId_idx" ON "jobs"("tenantId", "assignedFleetVehicleId");

-- CreateIndex
CREATE INDEX "trips_tenantId_fleetVehicleId_idx" ON "trips"("tenantId", "fleetVehicleId");

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_assignedFleetVehicleId_fkey" FOREIGN KEY ("assignedFleetVehicleId") REFERENCES "fleet_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assignedFleetVehicleId_fkey" FOREIGN KEY ("assignedFleetVehicleId") REFERENCES "fleet_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_fleetVehicleId_fkey" FOREIGN KEY ("fleetVehicleId") REFERENCES "fleet_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
