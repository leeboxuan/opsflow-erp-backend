import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { AuthModule } from "../../shared/auth/auth.module";
import { UsersModule } from "../../shared/users/users.module";
import { AuditModule } from "../../shared/audit/audit.module";

import { DriversController } from "./drivers.controller";
import { AdminDriversController } from "./admin-drivers.controller";
import { AdminDriversService } from "./admin-drivers.service";
import { DriverTripEarningsService } from "./driver-trip-earnings.service";
import { LocationService } from "./location/location.service";

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, AuditModule],
  controllers: [DriversController, AdminDriversController],
  providers: [AdminDriversService, DriverTripEarningsService, LocationService],
  exports: [LocationService, DriverTripEarningsService],
})
export class DriversModule {}
