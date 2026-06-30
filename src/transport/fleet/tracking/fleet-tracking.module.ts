import { Module } from "@nestjs/common";
import { AuthModule } from "../../../auth/auth.module";
import { PrismaModule } from "../../../prisma/prisma.module";
import { FleetTrackingController } from "./fleet-tracking.controller";
import { FleetTrackingService } from "./fleet-tracking.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FleetTrackingController],
  providers: [FleetTrackingService],
  exports: [FleetTrackingService],
})
export class FleetTrackingModule {}
