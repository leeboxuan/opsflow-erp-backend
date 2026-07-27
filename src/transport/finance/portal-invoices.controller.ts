import {
  Controller,
  Get,
  Param,
  Request,
  Res,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import type { Response } from "express";

import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import { InvoicesService } from "./invoices.service";
import { PortalInvoiceDto } from "./dto/portal-invoice.dto";

@ApiTags("Portal - Invoices")
@Controller("portal/invoices")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.CUSTOMER, Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
@ApiBearerAuth("JWT-auth")
export class PortalInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({
    summary: "List downloadable invoices for the portal (PDF-only)",
  })
  async list(@Request() req: any): Promise<PortalInvoiceDto[]> {
    const tenantId = req.tenant.tenantId as string | null;
    if (!tenantId) throw new BadRequestException("X-Tenant-Id is required");
    const customerCompanyId =
      req.tenant.role === Role.CUSTOMER
        ? (req.tenant.customerCompanyId as string)
        : undefined;

    return this.invoices.listPortalInvoices(tenantId, customerCompanyId);
  }

  @Get(":id/download")
  @ApiOperation({ summary: "Download an invoice PDF (secured)" })
  async download(
    @Request() req: any,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const tenantId = req.tenant.tenantId as string | null;
    if (!tenantId) throw new BadRequestException("X-Tenant-Id is required");
    const customerCompanyId =
      req.tenant.role === Role.CUSTOMER
        ? (req.tenant.customerCompanyId as string)
        : undefined;

    const { pdfBuffer, filename } = await this.invoices.downloadPortalInvoicePdf(
      tenantId,
      id,
      customerCompanyId,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  }
}

