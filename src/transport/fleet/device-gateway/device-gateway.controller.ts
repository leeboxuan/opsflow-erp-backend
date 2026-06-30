import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DeviceGatewayService } from "./device-gateway.service";
import {
  DeviceGatewayEventDto,
  DeviceGatewayEventResponseDto,
} from "./dto/device-gateway-event.dto";
import { DeviceGatewayKeyGuard } from "./guards/device-gateway-key.guard";

@ApiTags("internal-device-gateway")
@Controller("internal/device-gateway")
@UseGuards(DeviceGatewayKeyGuard)
@ApiHeader({
  name: "x-device-gateway-key",
  required: true,
  description: "Shared secret for internal GPS device gateway ingestion",
})
export class DeviceGatewayController {
  constructor(private readonly deviceGateway: DeviceGatewayService) {}

  @Post("events")
  @ApiOperation({
    summary: "Ingest a GPS device gateway event (internal, key-authenticated)",
  })
  @ApiOkResponse({ type: DeviceGatewayEventResponseDto })
  ingestEvent(
    @Body() dto: DeviceGatewayEventDto,
  ): Promise<DeviceGatewayEventResponseDto> {
    return this.deviceGateway.ingestLocationEvent(dto);
  }
}
