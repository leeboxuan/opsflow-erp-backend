import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";
import { VehiclesController } from "./vehicles.controller";
import { FleetController } from "./fleet.controller";
import { VehiclesService } from "./vehicles.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [VehiclesController, FleetController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
