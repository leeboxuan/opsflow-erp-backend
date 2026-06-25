-- AlterTable
ALTER TABLE "gps_devices" ADD COLUMN IF NOT EXISTS "lastBatteryVoltageMv" INTEGER;
ALTER TABLE "gps_devices" ADD COLUMN IF NOT EXISTS "lastBatteryVoltage" DECIMAL(6,3);
ALTER TABLE "gps_devices" ADD COLUMN IF NOT EXISTS "lastBatterySeenAt" TIMESTAMP(3);
ALTER TABLE "gps_devices" ADD COLUMN IF NOT EXISTS "lastSignalStrength" INTEGER;
ALTER TABLE "gps_devices" ADD COLUMN IF NOT EXISTS "lastSatelliteCount" INTEGER;

-- AlterTable
ALTER TABLE "gps_positions" ADD COLUMN IF NOT EXISTS "batteryVoltageMv" INTEGER;
ALTER TABLE "gps_positions" ADD COLUMN IF NOT EXISTS "batteryVoltage" DECIMAL(6,3);
ALTER TABLE "gps_positions" ADD COLUMN IF NOT EXISTS "signalStrength" INTEGER;
ALTER TABLE "gps_positions" ADD COLUMN IF NOT EXISTS "satelliteCount" INTEGER;
