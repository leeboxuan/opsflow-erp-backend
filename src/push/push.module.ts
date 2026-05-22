import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PushController } from "./push.controller";
import { PushDevicesService } from "./push-devices.service";
import { PushNotificationsService } from "./push-notifications.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PushController],
  providers: [PushDevicesService, PushNotificationsService],
  exports: [PushDevicesService, PushNotificationsService],
})
export class PushModule {}
