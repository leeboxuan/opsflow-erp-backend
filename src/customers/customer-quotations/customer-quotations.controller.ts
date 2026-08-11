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
import { CustomerQuotationsService } from "./customer-quotations.service";
import {
  AcceptCustomerQuotationDto,
  CreateBlankCustomerQuotationDto,
  CreateCustomerQuotationFromTemplateDto,
  ReplaceCustomerQuotationLinesDto,
  UpdateCustomerQuotationDto,
} from "./customer-quotations.dto";

@ApiTags("customer-quotations")
@Controller("customers/companies/:customerId/customer-quotations")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
@RequiresTenantModule(TenantModule.TRANSPORT)
@ApiBearerAuth("JWT-auth")
export class CustomerQuotationsController {
  constructor(private readonly quotations: CustomerQuotationsService) {}

  @Get()
  @ApiOperation({ summary: "List customer quotations (runs expiry materialization)" })
  list(@Request() req: any, @Param("customerId") customerId: string) {
    return this.quotations.list(req.tenant.tenantId, customerId);
  }

  @Post()
  @ApiOperation({ summary: "Create blank DRAFT quotation (assigns quotationNo)" })
  createBlank(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Body() dto: CreateBlankCustomerQuotationDto,
  ) {
    return this.quotations.createBlank(
      req.tenant.tenantId,
      customerId,
      dto ?? {},
      req.user?.userId ?? null,
    );
  }

  @Post("from-template")
  @ApiOperation({
    summary: "Create DRAFT quotation from customer rate template (frozen snapshot)",
  })
  createFromTemplate(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Body() dto: CreateCustomerQuotationFromTemplateDto,
  ) {
    return this.quotations.createFromTemplate(
      req.tenant.tenantId,
      customerId,
      dto,
      req.user?.userId ?? null,
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get quotation (materializes EXPIRED when applicable)" })
  getById(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
  ) {
    return this.quotations.getById(req.tenant.tenantId, customerId, id);
  }

  @Patch(":id")
  @ApiOperation({
    summary:
      "Update DRAFT quotation; customer change on populated draft requires confirmCustomerChange",
  })
  update(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @Body() dto: UpdateCustomerQuotationDto,
  ) {
    return this.quotations.update(
      req.tenant.tenantId,
      customerId,
      id,
      dto,
      req.user?.userId ?? null,
    );
  }

  @Put(":id/lines")
  @ApiOperation({ summary: "Replace DRAFT quotation lines and recalculate totals" })
  replaceLines(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @Body() dto: ReplaceCustomerQuotationLinesDto,
  ) {
    return this.quotations.replaceLines(
      req.tenant.tenantId,
      customerId,
      id,
      dto.lines ?? [],
      req.user?.userId ?? null,
    );
  }

  @Post(":id/issue")
  @ApiOperation({ summary: "Issue quotation: lock, set ISSUED, generate PDF" })
  issue(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
  ) {
    return this.quotations.issue(
      req.tenant.tenantId,
      customerId,
      id,
      req.user?.userId ?? null,
    );
  }

  @Post(":id/accept")
  @ApiOperation({
    summary:
      "Accept ISSUED quotation; requires acceptanceMethod (+ optional evidence). Staff recorder only.",
  })
  accept(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @Body() dto: AcceptCustomerQuotationDto,
  ) {
    return this.quotations.accept(
      req.tenant.tenantId,
      customerId,
      id,
      dto,
      req.user?.userId ?? null,
    );
  }

  @Post(":id/reject")
  @ApiOperation({ summary: "Reject ISSUED quotation" })
  reject(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
  ) {
    return this.quotations.reject(
      req.tenant.tenantId,
      customerId,
      id,
      req.user?.userId ?? null,
    );
  }

  @Post(":id/void")
  @ApiOperation({ summary: "Void DRAFT or ISSUED quotation (preferred over hard delete)" })
  void(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
  ) {
    return this.quotations.void(
      req.tenant.tenantId,
      customerId,
      id,
      req.user?.userId ?? null,
    );
  }

  @Get(":id/pdf")
  @ApiOperation({ summary: "Get signed URL for generated quotation PDF" })
  getPdf(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
  ) {
    return this.quotations.getPdfSignedUrl(
      req.tenant.tenantId,
      customerId,
      id,
    );
  }
}
