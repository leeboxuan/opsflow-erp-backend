import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { AuthModule } from "../../shared/auth/auth.module";
import { UsersModule } from "../../shared/users/users.module";

import { DriversController } from "./drivers.controller";
import { AdminDriversController } from "./admin-drivers.controller";
import { AdminDriversService } from "./admin-drivers.service";
import { LocationService } from "./location/location.service";

@Module({
  imports: [PrismaModule, AuthModule, UsersModule],
  controllers: [DriversController, AdminDriversController],
  providers: [AdminDriversService, LocationService],
  exports: [LocationService],
})
export class DriversModule {}