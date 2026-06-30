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
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "@/shared/auth/guards/role.guard";
import { Role } from "@prisma/client";
import { InvoicesService } from "./invoices.service";
import {
  CreateInvoiceDto,
  InvoicePrefillResponseDto,
  InvoiceableJobDto,
} from "./dto/invoice.dto";
import { DraftFromJobsDto } from "./dto/draft-from-jobs.dto";
import { ListInvoicesQueryDto } from "./dto/list-invoices-query.dto";
import { FileInterceptor } from "@nestjs/platform-express";

@ApiTags("Finance")
@Controller("finance/invoices")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER) // add Role.FINANCE later if you have it
@ApiBearerAuth("JWT-auth")
export class InvoicesController {
  @Get("jobs/:jobId/prefill")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  async prefillFromJob(
    @Request() req: any,
    @Param("jobId") jobId: string,
  ): Promise<InvoicePrefillResponseDto> {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.getInvoicePrefillFromJob(tenantId, jobId, accessUser);
  }

  @Get("companies/:companyId/invoiceable-jobs")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  async listInvoiceableJobs(
    @Request() req: any,
    @Param("companyId") companyId: string,
  ): Promise<{ items: InvoiceableJobDto[] }> {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.listInvoiceableJobsByCompany(tenantId, companyId, accessUser);
  }

  @Get("companies/:companyId/quotation-options")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  async listQuotationOptions(
    @Request() req: any,
    @Param("companyId") companyId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.listQuotationOptionsByCompany(tenantId, companyId, accessUser);
  }

  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async list(@Request() req: any, @Query() query: ListInvoicesQueryDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.listInvoices(tenantId, query, accessUser);
  }

  @Get(":id")
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async get(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.getInvoice(tenantId, id, accessUser);
  }
  // Update an existing Draft invoice (used by web: /invoices/[id]/edit)
  @Post(":id/draft")
  async updateDraft(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.updateDraftInvoice(tenantId, id, dto, accessUser);
  }

  @Patch(":id")
  async patchDraft(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.updateDraftInvoice(tenantId, id, dto, accessUser);
  }

  @Post()
  async create(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.createInvoice(tenantId, dto, accessUser);
  }

  @Post("draft")
  async createDraft(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.createDraftInvoice(tenantId, dto, accessUser);
  }

  @Post("draft/from-jobs")
  async draftFromJobs(@Request() req: any, @Body() dto: DraftFromJobsDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.getInvoiceDraftFromJobs(
      tenantId,
      dto.jobIds,
      accessUser,
    );
  }

  @Post(":id/issue")
  async issue(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.issueInvoice(tenantId, id, accessUser);
  }

  @Post(":id/revert")
  async revertToDraft(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
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
  async uploadPdf(
    @Request() req: any,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }

    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };

    return this.invoices.uploadInvoicePdf(tenantId, id, file, accessUser);
  }

  @Get(":id/preview")
  async preview(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.getInvoicePreview(tenantId, id, accessUser);
  }

  @Post(":id/generate")
  async generate(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.generateInvoicePdf(tenantId, id, accessUser);
  }

  @Get(":id/pdf/download")
  async getDownloadUrl(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };

    return this.invoices.getInvoicePdfDownloadUrl(tenantId, id, accessUser);
  }
}
