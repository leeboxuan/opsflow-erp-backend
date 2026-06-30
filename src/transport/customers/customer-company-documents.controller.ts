import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { Role } from "@prisma/client";

import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { CustomersService } from "./customers.service";
import {
  CustomerCompanyDocumentDto,
  ListCustomerCompanyDocumentsQueryDto,
} from "./dto/customers.dto";

@ApiTags("customer-companies")
@Controller("customer-companies")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@ApiBearerAuth("JWT-auth")
@Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
export class CustomerCompanyDocumentsController {
  constructor(private readonly customersService: CustomersService) {}

  @Get(":customerCompanyId/documents")
  @ApiOperation({
    summary: "List customer company documents (includes generated invoice PDFs; excludes quotation files)",
  })
  async listDocuments(
    @Request() req: any,
    @Param("customerCompanyId") customerCompanyId: string,
    @Query() query: ListCustomerCompanyDocumentsQueryDto,
  ): Promise<{
    data: CustomerCompanyDocumentDto[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    return this.customersService.listCustomerCompanyDocuments(
      req.tenant.tenantId,
      customerCompanyId,
      query,
    );
  }

  @Post(":customerCompanyId/documents")
  @ApiOperation({
    summary: "Upload generic customer company document (storage-only, no parsing)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Generic file upload (pdf, image, office docs, etc.)",
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadDocument(
    @Request() req: any,
    @Param("customerCompanyId") customerCompanyId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<CustomerCompanyDocumentDto> {
    if (!file) throw new BadRequestException("file is required");
    return this.customersService.uploadCustomerCompanyDocument(
      req.tenant.tenantId,
      customerCompanyId,
      file,
      req.user?.userId ?? null,
    );
  }

  @Get(":customerCompanyId/documents/:documentId")
  @ApiOperation({ summary: "Get customer company document metadata by id" })
  async getDocument(
    @Request() req: any,
    @Param("customerCompanyId") customerCompanyId: string,
    @Param("documentId") documentId: string,
  ): Promise<CustomerCompanyDocumentDto> {
    return this.customersService.getCustomerCompanyDocument(
      req.tenant.tenantId,
      customerCompanyId,
      documentId,
    );
  }

  @Delete(":customerCompanyId/documents/:documentId")
  @ApiOperation({ summary: "Delete customer company document" })
  async deleteDocument(
    @Request() req: any,
    @Param("customerCompanyId") customerCompanyId: string,
    @Param("documentId") documentId: string,
  ): Promise<{ ok: true }> {
    return this.customersService.deleteCustomerCompanyDocument(
      req.tenant.tenantId,
      customerCompanyId,
      documentId,
      req.user?.userId ?? null,
    );
  }

  @Get(":customerCompanyId/documents/:documentId/download")
  @ApiOperation({ summary: "Get signed download URL for customer company document" })
  async downloadDocument(
    @Request() req: any,
    @Param("customerCompanyId") customerCompanyId: string,
    @Param("documentId") documentId: string,
  ): Promise<{ url: string | null; expiresInSeconds: number }> {
    return this.customersService.getCustomerCompanyDocumentDownloadUrl(
      req.tenant.tenantId,
      customerCompanyId,
      documentId,
    );
  }
}
