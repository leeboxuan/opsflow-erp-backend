import { Module } from "@nestjs/common";
import { AuthModule } from "../../../shared/auth/auth.module";
import { PrismaModule } from "../../../shared/prisma/prisma.module";
import { FleetVehiclesController } from "./fleet-vehicles.controller";
import { FleetVehiclesService } from "./fleet-vehicles.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FleetVehiclesController],
  providers: [FleetVehiclesService],
  exports: [FleetVehiclesService],
})
export class FleetVehiclesModule {}
