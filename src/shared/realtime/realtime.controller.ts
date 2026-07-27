import { Controller, Get, Req, Sse, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { Role } from "@prisma/client";
import type { MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RealtimeEventsService } from "./realtime-events.service";

@ApiTags("realtime")
@Controller("realtime")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.DRIVER)
@ApiBearerAuth("JWT-auth")
@ApiHeader({
  name: "x-tenant-id",
  required: true,
  description: "Tenant scope for the event stream",
})
export class RealtimeController {
  constructor(private readonly realtimeEvents: RealtimeEventsService) {}

  @Get("events")
  @Sse()
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.DRIVER)
  @ApiOperation({
    summary: "Tenant-scoped Server-Sent Events stream (metadata only, no full records)",
  })
  @ApiProduces("text/event-stream")
  events(@Req() req: any): Observable<MessageEvent> {
    const tenantId = req.tenant.tenantId as string;
    const role = req.tenant.role as Role;
    const userId = req.user?.userId as string;
    return this.realtimeEvents.stream({ tenantId, role, userId });
  }
}
