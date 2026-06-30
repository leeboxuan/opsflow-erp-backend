import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../shared/prisma/prisma.module";
import { DeviceGatewayController } from "./device-gateway.controller";
import { DeviceGatewayService } from "./device-gateway.service";
import { DeviceGatewayKeyGuard } from "./guards/device-gateway-key.guard";

@Module({
  imports: [PrismaModule],
  controllers: [DeviceGatewayController],
  providers: [DeviceGatewayService, DeviceGatewayKeyGuard],
  exports: [DeviceGatewayService],
})
export class DeviceGatewayModule {}
