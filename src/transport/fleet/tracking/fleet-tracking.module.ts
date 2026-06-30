import { Module } from "@nestjs/common";
import { AuthModule } from "../../../shared/auth/auth.module";
import { PrismaModule } from "../../../shared/prisma/prisma.module";
import { FleetTrackingController } from "./fleet-tracking.controller";
import { FleetTrackingService } from "./fleet-tracking.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FleetTrackingController],
  providers: [FleetTrackingService],
  exports: [FleetTrackingService],
})
export class FleetTrackingModule {}
