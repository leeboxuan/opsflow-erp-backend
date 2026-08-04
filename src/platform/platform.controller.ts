import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { PlatformAdminGuard } from "../shared/auth/guards/platform-admin.guard";
import { PlatformService } from "./platform.service";
import {
  CreatePlatformAdminDto,
  CreatePlatformTenantDto,
  PlatformAuditQueryDto,
  SetTenantModulesDto,
  SuspendTenantDto,
  UpdatePlatformAdminDto,
  UpdatePlatformTenantDto,
} from "./dto/platform.dto";

@ApiTags("platform")
@ApiBearerAuth("JWT-auth")
@Controller("platform")
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  private actor(req: any): { platformAdminId: string; userId: string } {
    return {
      platformAdminId: req.user.platformAdminId,
      userId: req.user.userId,
    };
  }

  @Get("me")
  @ApiOperation({ summary: "Current platform admin profile" })
  getMe(@Request() req: any) {
    return this.platform.getMe(req.user.platformAdminId, req.user.userId);
  }

  @Get("tenants")
  @ApiOperation({ summary: "List all tenants (platform)" })
  listTenants(
    @Query() query: { q?: string; page?: string; pageSize?: string },
  ) {
    return this.platform.listTenants(query);
  }

  @Post("tenants")
  @ApiOperation({ summary: "Create tenant" })
  createTenant(@Body() dto: CreatePlatformTenantDto, @Request() req: any) {
    return this.platform.createTenant(dto, this.actor(req));
  }

  @Get("tenants/:tenantId")
  @ApiOperation({ summary: "Get tenant by id" })
  getTenant(@Param("tenantId") tenantId: string) {
    return this.platform.getTenant(tenantId);
  }

  @Patch("tenants/:tenantId")
  @ApiOperation({ summary: "Update tenant (slug immutable once users exist)" })
  updateTenant(
    @Param("tenantId") tenantId: string,
    @Body() dto: UpdatePlatformTenantDto,
    @Request() req: any,
  ) {
    return this.platform.updateTenant(tenantId, dto, this.actor(req));
  }

  @Post("tenants/:tenantId/suspend")
  @ApiOperation({ summary: "Suspend tenant (blocks ordinary users)" })
  suspend(
    @Param("tenantId") tenantId: string,
    @Body() dto: SuspendTenantDto,
    @Request() req: any,
  ) {
    return this.platform.suspendTenant(tenantId, dto.reason, this.actor(req));
  }

  @Post("tenants/:tenantId/reactivate")
  @ApiOperation({ summary: "Reactivate suspended tenant" })
  reactivate(
    @Param("tenantId") tenantId: string,
    @Body() dto: SuspendTenantDto,
    @Request() req: any,
  ) {
    return this.platform.reactivateTenant(
      tenantId,
      dto.reason,
      this.actor(req),
    );
  }

  @Get("tenants/:tenantId/modules")
  @ApiOperation({ summary: "Get tenant module entitlements" })
  getModules(@Param("tenantId") tenantId: string) {
    return this.platform.getModules(tenantId);
  }

  @Put("tenants/:tenantId/modules")
  @ApiOperation({
    summary:
      "Set tenant module entitlements (Phase 1 platform config; Phase 3 tightens ops route gates)",
  })
  setModules(
    @Param("tenantId") tenantId: string,
    @Body() dto: SetTenantModulesDto,
    @Request() req: any,
  ) {
    return this.platform.setModules(tenantId, dto, this.actor(req));
  }

  @Get("admins")
  @ApiOperation({ summary: "List platform admins" })
  listAdmins() {
    return this.platform.listAdmins();
  }

  @Post("admins")
  @ApiOperation({ summary: "Create / promote platform admin (audited)" })
  createAdmin(@Body() dto: CreatePlatformAdminDto, @Request() req: any) {
    return this.platform.createAdmin(dto, this.actor(req));
  }

  @Patch("admins/:adminId")
  @ApiOperation({ summary: "Enable/disable platform admin (audited)" })
  updateAdmin(
    @Param("adminId") adminId: string,
    @Body() dto: UpdatePlatformAdminDto,
    @Request() req: any,
  ) {
    return this.platform.updateAdmin(adminId, dto, this.actor(req));
  }

  @Get("audit")
  @ApiOperation({ summary: "List platform audit log (basic filter)" })
  listAudit(@Query() query: PlatformAuditQueryDto) {
    return this.platform.listAudit(query);
  }
}
