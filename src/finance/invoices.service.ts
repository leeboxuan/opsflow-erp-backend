import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateInvoiceDto, InvoiceDto } from "./dto/invoice.dto";
import { OrderStatus } from "@prisma/client";

function toBasisPoints(rate: number) {
  return Math.round(rate);
}

function extractDraftMeta(snapshot: any) {
  const s = snapshot ?? {};
  return {
    orderIds: Array.isArray(s.orderIds) ? (s.orderIds as string[]) : [],
    confirmedAt: s.confirmedAt ? new Date(s.confirmedAt) : null,
    confirmedByUserId: s.confirmedByUserId ?? null,
  };
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

    return invoices.map((inv) => this.toDtoWithNames(inv));
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
    return this.toDtoWithNames(inv);
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

    return this.toDtoWithNames(created);
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

  private async toDtoWithNames(inv: any, fallbackOrderIds?: string[]): Promise<InvoiceDto> {
    const snap = inv.snapshot as any;
    const meta = extractDraftMeta(snap);
  
    const confirmedByUserId = meta.confirmedByUserId;
    const markedAsSentByUserId = inv.issuedByUserId ?? null;
  
    const userIds = [confirmedByUserId, markedAsSentByUserId].filter(Boolean) as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  
    const nameById = new Map<string, string>(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  
    const orderIds = inv.orders?.length ? inv.orders.map((o: any) => o.id) : (fallbackOrderIds ?? meta.orderIds);
  
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
      orderIds,
  
      confirmedAt: meta.confirmedAt,
      confirmedByUserId: confirmedByUserId,
      confirmedByName: confirmedByUserId ? (nameById.get(confirmedByUserId) ?? null) : null,
  
      markedAsSentAt: inv.issuedAt ?? null,
      markedAsSentByUserId: markedAsSentByUserId,
      markedAsSentByName: markedAsSentByUserId ? (nameById.get(markedAsSentByUserId) ?? null) : null,
  
      pdfKey: inv.pdfKey ?? null,
      pdfGeneratedAt: inv.pdfGeneratedAt ?? null,
    };
  }
  

  async createDraftInvoice(
    tenantId: string,
    dto: CreateInvoiceDto,
    confirmedByUserId?: string,
  ): Promise<InvoiceDto> {
    const orders = await this.prisma.transportOrder.findMany({
      where: { tenantId, id: { in: dto.orderIds } },
      select: { id: true, status: true, invoiceId: true, customerName: true },
    });
  
    if (orders.length !== dto.orderIds.length) {
      throw new BadRequestException("Some orders not found under this tenant");
    }
  
    const bad = orders.find(
      (o) => o.invoiceId || ![OrderStatus.Delivered, OrderStatus.Closed].includes(o.status),
    );
    if (bad) {
      throw new BadRequestException("Orders must be Delivered/Closed and not already invoiced");
    }
  
    const normalized = dto.lineItems.map((l) => {
      const amountCents = l.qty * l.unitPriceCents;
      const taxCents = l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return { ...l, amountCents, taxCents, taxRate: toBasisPoints(l.taxRate) };
    });
  
    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;
  
    const issueDate = dto.issueDateISO ? new Date(dto.issueDateISO + "T00:00:00") : new Date();
    const dueDate = dto.dueDateISO ? new Date(dto.dueDateISO + "T00:00:00") : null;
  
    const invoiceNo = await this.nextInvoiceNo(tenantId, issueDate);
  
    const created = await this.prisma.invoice.create({
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
        snapshot: {
          stage: "Draft",
          orderIds: dto.orderIds,
          confirmedAt: new Date().toISOString(),
          confirmedByUserId: confirmedByUserId ?? null,
        },
      },
      include: {
        lineItems: true,
        orders: { select: { id: true } }, // empty until "Sent"
      },
    });
  
    // Return orderIds from dto since orders aren't linked yet
    return await this.toDtoWithNames(created, dto.orderIds);
  }
  
  
  async issueInvoice(tenantId: string, invoiceId: string, issuedByUserId?: string) {
    const issuedAt = new Date();
  
    const result = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { lineItems: true },
      });
  
      if (!inv) throw new BadRequestException("Invoice not found");
      if (inv.status !== "Draft") throw new BadRequestException("Invoice is not Draft");
  
      const orderIds: string[] = (inv.snapshot as any)?.orderIds ?? [];
      if (!orderIds.length) throw new BadRequestException("No orders on draft invoice");
  
      // re-validate eligibility
      const orders = await tx.transportOrder.findMany({
        where: { tenantId, id: { in: orderIds } },
        select: { id: true, status: true, invoiceId: true, orderRef: true, internalRef: true, priceCents: true },
      });
  
      if (orders.length !== orderIds.length) {
        throw new BadRequestException("Some orders no longer exist");
      }
  
      const bad = orders.find((o) => o.invoiceId || o.status !== OrderStatus.Delivered);
      if (bad) throw new BadRequestException("Some orders are no longer eligible to invoice");
  
      // concurrency-safe link: only link those that are still invoiceId=null
      const updated = await tx.transportOrder.updateMany({
        where: { tenantId, id: { in: orderIds }, invoiceId: null },
        data: { invoiceId: inv.id, status: OrderStatus.Closed },
      });
  
      if (updated.count !== orderIds.length) {
        throw new BadRequestException("Some orders were invoiced by someone else");
      }
  
      const finalSnapshot = {
        stage: "Sent",
        invoice: {
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          customerName: inv.customerName,
          currency: inv.currency,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          notes: inv.notes,
          subtotalCents: inv.subtotalCents,
          taxCents: inv.taxCents,
          totalCents: inv.totalCents,
        },
        orders: orders.map((o) => ({
          id: o.id,
          orderRef: o.orderRef,
          internalRef: o.internalRef,
          priceCents: o.priceCents,
        })),
        lineItems: inv.lineItems,
      };
  
      const locked = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: "Sent",
          issuedAt,
          issuedByUserId: issuedByUserId ?? null,
          lockedAt: issuedAt,
          snapshot: finalSnapshot,
        },
        include: { lineItems: true, orders: { select: { id: true } } },
      });
  
      return locked;
    });
  
    // PDF generation + storage upload happens AFTER commit (safer)
    // If it fails, invoice is still Issued; you can retry via "regenerate pdf" endpoint.
    return this.toDtoWithNames(result);
  }

  async revertInvoiceToDraft(tenantId: string, invoiceId: string, userId?: string) {
    const now = new Date();
  
    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { orders: { select: { id: true } }, lineItems: true },
      });
  
      if (!inv) throw new BadRequestException("Invoice not found");
      if (inv.status !== "Sent") throw new BadRequestException("Only Sent invoices can be reverted");
  
      const linkedOrderIds = inv.orders.map((o) => o.id);
  
      // unlink orders (make them "awaiting invoice" again)
      await tx.transportOrder.updateMany({
        where: { tenantId, id: { in: linkedOrderIds }, invoiceId: inv.id },
        data: { invoiceId: null },
      });
  
      const prevSnap = inv.snapshot as any;
      const draftMeta = extractDraftMeta(prevSnap);
  
      const nextSnapshot = {
        ...(prevSnap ?? {}),
        stage: "Draft",
        orderIds: linkedOrderIds,
        // keep original confirm info if it existed
        confirmedAt: draftMeta.confirmedAt ? draftMeta.confirmedAt.toISOString() : prevSnap?.confirmedAt ?? null,
        confirmedByUserId: draftMeta.confirmedByUserId ?? prevSnap?.confirmedByUserId ?? null,
        // optional audit
        revertedAt: now.toISOString(),
        revertedByUserId: userId ?? null,
      };
  
      const inv2 = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: "Draft",
          issuedAt: null,
          issuedByUserId: null,
          lockedAt: null,
          snapshot: nextSnapshot,
        },
        include: { lineItems: true, orders: { select: { id: true } } }, // now empty
      });
  
      return inv2;
    });
  
    // invoice has no linked orders now; return with snapshot orderIds for UI continuity
    const snap = updated.snapshot as any;
    const orderIds = Array.isArray(snap?.orderIds) ? snap.orderIds : [];
    return await this.toDtoWithNames(updated, orderIds);
  }
  
  
}
