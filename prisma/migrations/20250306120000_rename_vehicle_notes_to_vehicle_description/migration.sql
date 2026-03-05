-- AlterTable: Rename Vehicle.notes to vehicleDescription (preserve existing data)
ALTER TABLE "vehicles" RENAME COLUMN "notes" TO "vehicleDescription";
