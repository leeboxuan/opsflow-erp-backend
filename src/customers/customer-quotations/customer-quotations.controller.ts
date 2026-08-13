import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
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
  CreateCustomerQuotationFromMasterDto,
  CreateCustomerQuotationFromRateExcelDto,
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

  @Post("from-master")
  @ApiOperation({
    summary:
      "Create DRAFT quotation from ACTIVE master QUOTATION base template (deep copy, no Excel parse)",
  })
  createFromMaster(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Body() dto: CreateCustomerQuotationFromMasterDto,
  ) {
    return this.quotations.createFromMaster(
      req.tenant.tenantId,
      customerId,
      dto ?? {},
      req.user?.userId ?? null,
    );
  }

  @Post("from-rate-excel/preview")
  @ApiOperation({
    summary: "Preview DRAFT quotation lines parsed from a rate Excel workbook (in-memory)",
  })
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
  previewFromRateExcel(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    return this.quotations.previewFromRateExcel(
      req.tenant.tenantId,
      customerId,
      file,
    );
  }

  @Post("from-rate-excel")
  @ApiOperation({
    summary:
      "Create DRAFT quotation from rate Excel (frozen lines; does not touch templates/master datasets)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        title: { type: "string" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  createFromRateExcel(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateCustomerQuotationFromRateExcelDto,
  ) {
    if (!file) throw new BadRequestException("file is required");
    return this.quotations.createFromRateExcel(
      req.tenant.tenantId,
      customerId,
      file,
      dto ?? {},
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

  @Post(":id/signed-document/accept")
  @ApiOperation({
    summary:
      "Upload the customer's signed quotation and mark this quotation ACCEPTED",
  })
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
  uploadSignedDocumentAndAccept(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    return this.quotations.uploadSignedDocumentAndAccept(
      req.tenant.tenantId,
      customerId,
      id,
      file,
      req.user?.userId ?? null,
    );
  }

  @Post(":id/signed-document")
  @ApiOperation({
    summary:
      "Upload signed customer copy for ISSUED quotation (does not overwrite generated PDF)",
  })
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
  uploadSignedDocument(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    return this.quotations.uploadSignedDocument(
      req.tenant.tenantId,
      customerId,
      id,
      file,
      req.user?.userId ?? null,
    );
  }

  @Get(":id/signed-document")
  @ApiOperation({ summary: "Get signed URL for uploaded signed customer copy" })
  getSignedDocument(
    @Request() req: any,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
  ) {
    return this.quotations.getSignedDocumentUrl(
      req.tenant.tenantId,
      customerId,
      id,
    );
  }
}
