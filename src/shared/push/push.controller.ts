import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import {
  PushDeviceDto,
  RegisterPushDeviceDto,
  UnregisterPushDeviceDto,
} from "./dto/push-device.dto";
import { PushDevicesService } from "./push-devices.service";

@ApiTags("push")
@Controller("push/devices")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.DRIVER)
@ApiBearerAuth("JWT-auth")
@ApiHeader({ name: "x-tenant-id", required: true })
export class PushController {
  constructor(private readonly pushDevices: PushDevicesService) {}

  @Post()
  @ApiOperation({ summary: "Register or refresh an Expo push device token" })
  @ApiOkResponse({ type: PushDeviceDto })
  register(
    @Req() req: any,
    @Body() dto: RegisterPushDeviceDto,
  ): Promise<PushDeviceDto> {
    return this.pushDevices.register(actorFromReq(req), dto);
  }

  @Post("unregister")
  @ApiOperation({ summary: "Disable an Expo push device token for the current user" })
  @ApiOkResponse({ schema: { properties: { ok: { type: "boolean" } } } })
  unregister(
    @Req() req: any,
    @Body() dto: UnregisterPushDeviceDto,
  ): Promise<{ ok: true }> {
    return this.pushDevices.unregisterByToken(actorFromReq(req), dto.expoPushToken);
  }

  @Delete(":token")
  @ApiOperation({ summary: "Disable push device by Expo token (URL-encoded)" })
  @ApiOkResponse({ schema: { properties: { ok: { type: "boolean" } } } })
  unregisterByParam(
    @Req() req: any,
    @Param("token") token: string,
  ): Promise<{ ok: true }> {
    return this.pushDevices.unregisterByToken(
      actorFromReq(req),
      decodeURIComponent(token),
    );
  }
}

function actorFromReq(req: any) {
  return {
    tenantId: req.tenant.tenantId as string,
    userId: req.user.userId as string,
    role: req.tenant.role as Role,
  };
}
