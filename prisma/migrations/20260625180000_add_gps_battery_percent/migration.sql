-- AlterTable
ALTER TABLE "gps_devices" ADD COLUMN IF NOT EXISTS "lastBatteryPercent" INTEGER;

-- AlterTable
ALTER TABLE "gps_positions" ADD COLUMN IF NOT EXISTS "batteryPercent" INTEGER;
