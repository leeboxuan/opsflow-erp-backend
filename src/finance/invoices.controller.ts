import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RoleGuard, Roles } from "@/auth/guards/role.guard";
import { Role } from "@prisma/client";
import { InvoicesService } from "./invoices.service";
import { CreateInvoiceDto } from "./dto/invoice.dto";
import { ListInvoicesQueryDto } from "./dto/list-invoices-query.dto";

@ApiTags("Finance")
@Controller("finance/invoices")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER) // add Role.FINANCE later if you have it
@ApiBearerAuth("JWT-auth")
export class InvoicesController {
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

  
}
