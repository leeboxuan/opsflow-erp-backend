import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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

@ApiTags("Finance")
@Controller("finance/invoices")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS) // add Role.FINANCE later if you have it
@ApiBearerAuth("JWT-auth")
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  async list(@Request() req: any) {
    const tenantId = req.tenant.tenantId;
    return this.invoices.listInvoices(tenantId);
  }

  @Get(":id")
  async get(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    return this.invoices.getInvoice(tenantId, id);
  }

  @Post()
  async create(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    const tenantId = req.tenant.tenantId;
    return this.invoices.createInvoice(tenantId, dto);
  }

  @Post("draft")
  async createDraft(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.id;
    return this.invoices.createDraftInvoice(tenantId, dto, userId);
  }
  
  @Post(":id/issue")
  async issue(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const issuedByUserId = req.user?.id; // adapt to your auth context
    return this.invoices.issueInvoice(tenantId, id, issuedByUserId);
  }

  @Post(":id/revert")
  async revertToDraft(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.id;
    return this.invoices.revertInvoiceToDraft(tenantId, id, userId);
  }

  
}
