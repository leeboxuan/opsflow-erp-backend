import { Module } from "@nestjs/common";
import { AuthModule } from "../../../auth/auth.module";
import { PrismaModule } from "../../../prisma/prisma.module";
import { FleetVehiclesController } from "./fleet-vehicles.controller";
import { FleetVehiclesService } from "./fleet-vehicles.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FleetVehiclesController],
  providers: [FleetVehiclesService],
  exports: [FleetVehiclesService],
})
export class FleetVehiclesModule {}
