import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
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
import { CanonicalTenantRole, Role } from "@prisma/client";
import { actorRolesFromRequest } from "../auth/access-actor";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { AccessSurface } from "../auth/guards/access-surface.guard";
import { INTERNAL_STAFF_ROLES } from "../auth/canonical-tenant-role";
import { NotificationsService } from "./notifications.service";
import {
  MarkAllReadResponseDto,
  NotificationDto,
  NotificationsListResponseDto,
  UnreadCountResponseDto,
} from "./dto/notification.dto";
import { NotificationViewerContext } from "./notifications.visibility";

@ApiTags("notifications")
@Controller("notifications")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(...INTERNAL_STAFF_ROLES, CanonicalTenantRole.TRANSPORT_DRIVER)
@AccessSurface("member")
@ApiBearerAuth("JWT-auth")
@ApiHeader({ name: "x-tenant-id", required: true })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List notifications visible to the current user" })
  @ApiOkResponse({ type: NotificationsListResponseDto })
  list(
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<NotificationsListResponseDto> {
    return this.notifications.list(viewerFromReq(req), { limit, cursor });
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Unread notification count for current user context" })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  async unreadCount(@Req() req: any): Promise<UnreadCountResponseDto> {
    const unreadCount = await this.notifications.unreadCount(viewerFromReq(req));
    return { unreadCount };
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark one notification as read" })
  @ApiOkResponse({ type: NotificationDto })
  markRead(@Req() req: any, @Param("id") id: string): Promise<NotificationDto> {
    return this.notifications.markRead(viewerFromReq(req), id);
  }

  @Post("mark-all-read")
  @ApiOperation({ summary: "Mark all visible notifications as read" })
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  async markAllRead(@Req() req: any): Promise<MarkAllReadResponseDto> {
    const markedCount = await this.notifications.markAllRead(viewerFromReq(req));
    return { markedCount };
  }
}

function viewerFromReq(req: any): NotificationViewerContext {
  return {
    tenantId: req.tenant.tenantId as string,
    userId: req.user.userId as string,
    role: req.tenant.role as Role,
    roles: actorRolesFromRequest(req),
  };
}
