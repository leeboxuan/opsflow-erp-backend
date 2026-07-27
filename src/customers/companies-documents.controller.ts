import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { RoleGuard, Roles } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { CustomersService } from "./customers.service";
import {
  CustomerCompanyDocumentDto,
  ListCustomerCompanyDocumentsQueryDto,
} from "./dto/customers.dto";

@ApiTags("companies-documents")
@Controller("companies")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@ApiBearerAuth("JWT-auth")
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
export class CompaniesDocumentsController {
  constructor(private readonly customersService: CustomersService) {}

  @Get(":companyId/documents")
  @ApiOperation({ summary: "List company documents (including generated invoice PDFs)" })
  async listDocuments(
    @Req() req: any,
    @Param("companyId") companyId: string,
    @Query() query: ListCustomerCompanyDocumentsQueryDto,
  ): Promise<{ data: CustomerCompanyDocumentDto[]; meta: { page: number; pageSize: number; total: number } }> {
    return this.customersService.listCompanyDocuments(
      req.tenant.tenantId,
      companyId,
      query,
    );
  }

  @Get(":companyId/documents/:documentId/download")
  @ApiOperation({ summary: "Get signed download URL for company document" })
  async download(
    @Req() req: any,
    @Param("companyId") companyId: string,
    @Param("documentId") documentId: string,
  ) {
    return this.customersService.getCompanyDocumentDownloadUrl(
      req.tenant.tenantId,
      companyId,
      documentId,
    );
  }

  @Get(":companyId/documents/:documentId/view")
  @ApiOperation({ summary: "Get company document metadata and signed view URL" })
  async view(
    @Req() req: any,
    @Param("companyId") companyId: string,
    @Param("documentId") documentId: string,
  ): Promise<CustomerCompanyDocumentDto> {
    return this.customersService.getCompanyDocument(
      req.tenant.tenantId,
      companyId,
      documentId,
    );
  }

  @Patch(":companyId/documents/:documentId")
  @ApiOperation({ summary: "Update company document metadata" })
  async patch(
    @Req() req: any,
    @Param("companyId") companyId: string,
    @Param("documentId") documentId: string,
    @Query("fileName") fileName?: string,
  ): Promise<CustomerCompanyDocumentDto> {
    if (fileName === undefined) {
      throw new BadRequestException("fileName query is required");
    }
    return this.customersService.updateCompanyDocumentMetadata(
      req.tenant.tenantId,
      companyId,
      documentId,
      { fileName },
    );
  }

  @Delete(":companyId/documents/:documentId")
  @ApiOperation({ summary: "Delete company document" })
  async delete(
    @Req() req: any,
    @Param("companyId") companyId: string,
    @Param("documentId") documentId: string,
  ): Promise<{ ok: true }> {
    return this.customersService.deleteCompanyDocument(
      req.tenant.tenantId,
      companyId,
      documentId,
      req.user?.userId ?? null,
    );
  }
}
