import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateInvoiceDto, InvoiceDto } from "./dto/invoice.dto";
import { OrderStatus } from "@prisma/client";

function toBasisPoints(rate: number) {
  return Math.round(rate);
}

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  async listInvoices(tenantId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        lineItems: true,
        orders: { select: { id: true } },
      },
    });

    return invoices.map((inv) => this.toDto(inv));
  }

  async getInvoice(tenantId: string, id: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id },
      include: {
        lineItems: true,
        orders: { select: { id: true } },
      },
    });

    if (!inv) throw new BadRequestException("Invoice not found");
    return this.toDto(inv);
  }

  async createInvoice(
    tenantId: string,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceDto> {
    // Validate orders: belong to tenant, completed-ish, and not already invoiced
    const orders = await this.prisma.transportOrder.findMany({
      where: {
        tenantId,
        id: { in: dto.orderIds },
      },
      select: { id: true, status: true, invoiceId: true, customerName: true },
    });

    if (orders.length !== dto.orderIds.length) {
      throw new BadRequestException("Some orders not found under this tenant");
    }

    const bad = orders.find(
      (o) => o.invoiceId || o.status !== OrderStatus.Delivered,
    );
    if (bad) {
      throw new BadRequestException(
        "Orders must be Delivered/Closed and not already invoiced",
      );
    }

    // Compute totals from manual line items
    const normalized = dto.lineItems.map((l) => {
      const amountCents = l.qty * l.unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0; // basis points
      return {
        ...l,
        amountCents,
        taxCents,
        taxRate: toBasisPoints(l.taxRate),
      };
    });

    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;

    const issueDate = dto.issueDateISO
      ? new Date(dto.issueDateISO + "T00:00:00")
      : new Date();
    const dueDate = dto.dueDateISO
      ? new Date(dto.dueDateISO + "T00:00:00")
      : null;

    // Generate invoice no: INV-YYYYMM-#### (good enough for MVP)
    const invoiceNo = await this.nextInvoiceNo(tenantId, issueDate);

    const created = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          invoiceNo,
          customerName: dto.customerName,
          currency: dto.currency ?? "SGD",
          issueDate,
          dueDate,
          notes: dto.notes ?? null,
          status: "Draft",
          subtotalCents,
          taxCents,
          totalCents,
          lineItems: {
            create: normalized.map((l) => ({
              tenantId,
              description: l.description,
              qty: l.qty,
              unitPriceCents: l.unitPriceCents,
              amountCents: l.amountCents,
              taxCode: l.taxCode,
              taxRate: l.taxRate,
              taxCents: l.taxCents,
            })),
          },
        },
        include: {
          lineItems: true,
        },
      });

      // Tag orders
      await tx.transportOrder.updateMany({
        where: { tenantId, id: { in: dto.orderIds }, invoiceId: null },
        data: { invoiceId: inv.id, status: OrderStatus.Closed },
      });

      const invWithOrders = await tx.invoice.findFirst({
        where: { tenantId, id: inv.id },
        include: { lineItems: true, orders: { select: { id: true } } },
      });

      if (!invWithOrders)
        throw new BadRequestException("Failed to create invoice");
      return invWithOrders;
    });

    return this.toDto(created);
  }

  private async nextInvoiceNo(tenantId: string, issueDate: Date) {
    const yyyy = issueDate.getFullYear();
    const mm = String(issueDate.getMonth() + 1).padStart(2, "0");
    const prefix = `INV-${yyyy}${mm}-`;

    const latest = await this.prisma.invoice.findFirst({
      where: { tenantId, invoiceNo: { startsWith: prefix } },
      orderBy: { invoiceNo: "desc" },
      select: { invoiceNo: true },
    });

    const nextSeq = latest?.invoiceNo
      ? Number(latest.invoiceNo.slice(prefix.length)) + 1
      : 1;

    const seqStr = String(nextSeq).padStart(4, "0");
    return `${prefix}${seqStr}`;
  }

  private toDto(inv: any): InvoiceDto {
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      customerName: inv.customerName,
      currency: inv.currency,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      notes: inv.notes,
      subtotalCents: inv.subtotalCents,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
      lineItems: inv.lineItems.map((l: any) => ({
        id: l.id,
        description: l.description,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        amountCents: l.amountCents,
        taxCode: l.taxCode,
        taxRate: l.taxRate,
        taxCents: l.taxCents,
      })),
      orderIds: inv.orders?.map((o: any) => o.id) ?? [],
    };
  }
}
