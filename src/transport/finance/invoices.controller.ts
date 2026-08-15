import {
  BadRequestException,
  Body,
  Controller,
  Patch,
  Get,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { DestructiveActionGuard } from "../../shared/auth/guards/destructive-action.guard";
import { DestructiveAction } from "../../shared/auth/guards/destructive-action.decorator";
import { CanonicalTenantRole, Role, TenantModule } from "@prisma/client";
import { InvoicesService } from "./invoices.service";
import {
  CreateInvoiceDto,
  InvoicePrefillResponseDto,
  InvoiceableJobDto,
} from "./dto/invoice.dto";
import { DraftFromJobsDto } from "./dto/draft-from-jobs.dto";
import { ListInvoicesQueryDto } from "./dto/list-invoices-query.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { accessActorFromRequest } from "../../shared/auth/access-actor";

@ApiTags("Finance")
@Controller("finance/invoices")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard, DestructiveActionGuard)
@RequiresTenantModule(TenantModule.FINANCE)
@Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
@ApiBearerAuth("JWT-auth")
export class InvoicesController {
  @Get("jobs/:jobId/prefill")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async prefillFromJob(
    @Request() req: any,
    @Param("jobId") jobId: string,
  ): Promise<InvoicePrefillResponseDto> {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.getInvoicePrefillFromJob(tenantId, jobId, accessUser);
  }

  @Get("companies/:companyId/invoiceable-jobs")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async listInvoiceableJobs(
    @Request() req: any,
    @Param("companyId") companyId: string,
  ): Promise<{ items: InvoiceableJobDto[] }> {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.listInvoiceableJobsByCompany(tenantId, companyId, accessUser);
  }

  @Get("companies/:companyId/quotation-options")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async listQuotationOptions(
    @Request() req: any,
    @Param("companyId") companyId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.listQuotationOptionsByCompany(tenantId, companyId, accessUser);
  }

  @Get("companies/:companyId/commercial-agreements")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async listCommercialAgreements(
    @Request() req: any,
    @Param("companyId") companyId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.listCommercialAgreementsByCompany(
      tenantId,
      companyId,
      accessUser,
    );
  }

  @Get("companies/:companyId/invoiceable-charges")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async listInvoiceableCharges(
    @Request() req: any,
    @Param("companyId") companyId: string,
    @Query("quotationId") quotationId?: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.listInvoiceableChargesByCompany(
      tenantId,
      companyId,
      accessUser,
      quotationId || null,
    );
  }

  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async list(@Request() req: any, @Query() query: ListInvoicesQueryDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.listInvoices(tenantId, query, accessUser);
  }

  @Get(":id")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async get(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.getInvoice(tenantId, id, accessUser);
  }
  // Update an existing Draft invoice (used by web: /invoices/[id]/edit)
  @Post(":id/draft")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async updateDraft(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.updateDraftInvoice(tenantId, id, dto, accessUser);
  }

  @Patch(":id")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async patchDraft(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.updateDraftInvoice(tenantId, id, dto, accessUser);
  }

  @Post()
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async create(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.createInvoice(tenantId, dto, accessUser);
  }

  @Post("draft")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async createDraft(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.createDraftInvoice(tenantId, dto, accessUser);
  }

  @Post("draft/from-jobs")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async draftFromJobs(@Request() req: any, @Body() dto: DraftFromJobsDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.getInvoiceDraftFromJobs(
      tenantId,
      dto.jobIds,
      accessUser,
    );
  }

  @Post(":id/issue")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  @DestructiveAction({
    resource: "INVOICE",
    action: "ISSUE",
    requireReasonForPlatformAdmin: false,
  })
  async issue(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.issueInvoice(tenantId, id, accessUser);
  }

  @Post(":id/void")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  @DestructiveAction({ resource: "INVOICE", action: "VOID" })
  async voidInvoice(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.voidInvoice(tenantId, id, accessUser);
  }

  @Post(":id/paid")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  @DestructiveAction({
    resource: "INVOICE",
    action: "PAID",
    requireReasonForPlatformAdmin: false,
  })
  async markPaid(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.markInvoicePaid(tenantId, id, accessUser);
  }

  @Post(":id/revert")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  @DestructiveAction({ resource: "INVOICE", action: "REVERT" })
  async revertToDraft(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body?: { reason?: string },
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.revertInvoiceToDraft(tenantId, id, accessUser);
  }

  @Post(":id/pdf")
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async uploadPdf(
    @Request() req: any,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }

    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);

    return this.invoices.uploadInvoicePdf(tenantId, id, file, accessUser);
  }

  @Get(":id/preview")
  async preview(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.getInvoicePreview(tenantId, id, accessUser);
  }

  @Post(":id/generate")
  @Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
  async generate(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);
    return this.invoices.generateInvoicePdf(tenantId, id, accessUser);
  }

  @Get(":id/pdf/download")
  async getDownloadUrl(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = accessActorFromRequest(req);

    return this.invoices.getInvoicePdfDownloadUrl(tenantId, id, accessUser);
  }
}
