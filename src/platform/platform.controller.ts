import {
  Body,
  Controller,
  Get,
  Headers,
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
  CreatePlatformTenantUserDto,
  PlatformAuditQueryDto,
  PlatformTenantUsersQueryDto,
  ResetPlatformTenantUserPasswordDto,
  SetTenantModulesDto,
  SuspendTenantDto,
  UpdatePlatformAdminDto,
  UpdatePlatformTenantDto,
  UpdatePlatformTenantUserDto,
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

  private correlationId(
    headers: Record<string, string | string[] | undefined>,
  ): string | null {
    const raw =
      headers["x-request-id"] ??
      headers["x-correlation-id"] ??
      headers["x-idempotency-key"];
    if (Array.isArray(raw)) return raw[0] ?? null;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
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

  @Get("tenants/:tenantId/users")
  @ApiOperation({ summary: "List tenant users (platform; excludes DRIVER)" })
  listTenantUsers(
    @Param("tenantId") tenantId: string,
    @Query() query: PlatformTenantUsersQueryDto,
  ) {
    return this.platform.listTenantUsers(tenantId, query);
  }

  @Post("tenants/:tenantId/users")
  @ApiOperation({
    summary:
      "Create tenant user with initial password (platform; no invite path)",
  })
  createTenantUser(
    @Param("tenantId") tenantId: string,
    @Body() dto: CreatePlatformTenantUserDto,
    @Request() req: any,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.platform.createTenantUser(
      tenantId,
      dto,
      this.actor(req),
      this.correlationId(headers),
    );
  }

  @Patch("tenants/:tenantId/users/:userId")
  @ApiOperation({
    summary:
      "Update tenant user (name/phone/role/status; no username; no hard delete)",
  })
  updateTenantUser(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Body() dto: UpdatePlatformTenantUserDto,
    @Request() req: any,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.platform.updateTenantUser(
      tenantId,
      userId,
      dto,
      this.actor(req),
      this.correlationId(headers),
    );
  }

  @Post("tenants/:tenantId/users/:userId/reset-password")
  @ApiOperation({
    summary:
      "Reset tenant user password via Supabase (platform; warehouse + office)",
  })
  resetTenantUserPassword(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Body() dto: ResetPlatformTenantUserPasswordDto,
    @Request() req: any,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.platform.resetTenantUserPassword(
      tenantId,
      userId,
      dto.password,
      this.actor(req),
      this.correlationId(headers),
    );
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
