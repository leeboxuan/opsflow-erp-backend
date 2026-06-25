-- CreateTable
CREATE TABLE "gps_devices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "terminalId" TEXT NOT NULL,
    "imei" TEXT,
    "simNumber" TEXT,
    "model" TEXT NOT NULL DEFAULT 'TK905B-4G',
    "protocol" TEXT NOT NULL DEFAULT 'JT808',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastLat" DECIMAL(10,7),
    "lastLng" DECIMAL(10,7),
    "lastSpeedKph" DOUBLE PRECISION,
    "lastHeading" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gps_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_positions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gpsDeviceId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "speedKph" DOUBLE PRECISION,
    "heading" INTEGER,
    "altitude" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawProtocol" TEXT,
    "rawMessageId" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gps_devices_terminalId_key" ON "gps_devices"("terminalId");

-- CreateIndex
CREATE INDEX "gps_devices_tenantId_idx" ON "gps_devices"("tenantId");

-- CreateIndex
CREATE INDEX "gps_devices_tenantId_vehicleId_idx" ON "gps_devices"("tenantId", "vehicleId");

-- CreateIndex
CREATE INDEX "gps_devices_tenantId_driverId_idx" ON "gps_devices"("tenantId", "driverId");

-- CreateIndex
CREATE INDEX "gps_positions_gpsDeviceId_recordedAt_idx" ON "gps_positions"("gpsDeviceId", "recordedAt");

-- CreateIndex
CREATE INDEX "gps_positions_vehicleId_recordedAt_idx" ON "gps_positions"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "gps_positions_tenantId_recordedAt_idx" ON "gps_positions"("tenantId", "recordedAt");

-- AddForeignKey
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_gpsDeviceId_fkey" FOREIGN KEY ("gpsDeviceId") REFERENCES "gps_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_positions" ADD CONSTRAINT "gps_positions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
