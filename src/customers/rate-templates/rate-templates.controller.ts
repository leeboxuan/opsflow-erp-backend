import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { RateTemplatesService } from "./rate-templates.service";
import {
  CreateBlankRateTemplateDto,
  CreateRateTemplateFromMasterDto,
  DuplicateRateTemplateDto,
  ReplaceRateTemplateRowsDto,
  UpdateRateTemplateDto,
} from "./rate-templates.dto";

@ApiTags("customer-rate-templates")
@Controller("customers/companies/:customerId/rate-templates")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
@RequiresTenantModule(TenantModule.TRANSPORT)
@ApiBearerAuth("JWT-auth")
export class RateTemplatesController {
  constructor(private readonly rateTemplates: RateTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "List customer rate templates" })
  list(@Request() req: any, @Param("customerId") customerId: string) {
    return this.rateTemplates.list(req.tenant.tenantId, customerId);
  }

  @Post()
  @ApiOperation({ summary: "Create blank customer rate template" })
  createBlank(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Body() dto: CreateBlankRateTemplateDto,
  ) {
    return this.rateTemplates.createBlank(
      req.tenant.tenantId,
      customerId,
      dto,
      req.user?.userId ?? null,
    );
  }

  @Post("from-master")
  @ApiOperation({
    summary:
      "Create template by copying ACTIVE master QUOTATION dataset rows (independent copy)",
  })
  createFromMaster(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Body() dto: CreateRateTemplateFromMasterDto,
  ) {
    return this.rateTemplates.createFromMaster(
      req.tenant.tenantId,
      customerId,
      dto,
      req.user?.userId ?? null,
    );
  }

  @Post(":id/duplicate")
  @ApiOperation({ summary: "Duplicate a customer rate template" })
  duplicate(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @Body() dto: DuplicateRateTemplateDto,
  ) {
    return this.rateTemplates.duplicate(
      req.tenant.tenantId,
      customerId,
      id,
      dto ?? {},
      req.user?.userId ?? null,
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get customer rate template with rows" })
  getById(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
  ) {
    return this.rateTemplates.getById(req.tenant.tenantId, customerId, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update rate template metadata/status" })
  update(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @Body() dto: UpdateRateTemplateDto,
  ) {
    return this.rateTemplates.update(
      req.tenant.tenantId,
      customerId,
      id,
      dto,
      req.user?.userId ?? null,
    );
  }

  @Put(":id/rows")
  @ApiOperation({ summary: "Replace all rows on a rate template" })
  replaceRows(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @Body() dto: ReplaceRateTemplateRowsDto,
  ) {
    return this.rateTemplates.replaceRows(
      req.tenant.tenantId,
      customerId,
      id,
      dto.rows ?? [],
      req.user?.userId ?? null,
    );
  }
}
