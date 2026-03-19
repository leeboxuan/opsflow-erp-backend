import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
} from "../common/pagination";
import { applyMappedFilter } from "../common/listing/listing.filters";
import { buildOrderBy } from "../common/listing/listing.sort";
import { applyQSearch } from "../common/listing/listing.search";
import { CreateInvoiceDto, InvoiceDto } from "./dto/invoice.dto";
import { OrderStatus, Role } from "@prisma/client";
import { SupabaseService } from "../auth/supabase.service";

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
  constructor(
    private prisma: PrismaService,
    private supabaseService: SupabaseService,
  ) {}

  private readonly INVOICE_PDFS_BUCKET = "invoice-documents";
  private readonly PDF_SIGNED_URL_TTL_SECONDS = 60 * 10;

  private safeFileName(value: string) {
    return value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  private getCustomerCompanyIdOrThrow(user: any): string {
    if (user?.role !== Role.CUSTOMER) {
      throw new ForbiddenException("Access denied");
    }
    const customerCompanyId = user?.customerCompanyId;
    if (!customerCompanyId) {
      throw new ForbiddenException(
        "CUSTOMER user is missing customerCompanyId",
      );
    }
    return customerCompanyId;
  }

  private assertCustomerCanOnlyRead(user: any) {
    if (user?.role !== Role.CUSTOMER) return;
    // Ensure we throw ForbiddenException when customerCompanyId is missing too.
    this.getCustomerCompanyIdOrThrow(user);
    throw new ForbiddenException(
      "CUSTOMER users are only allowed to read invoices",
    );
  }

  private async invoiceBelongsToCustomerCompany(
    tenantId: string,
    inv: any,
    customerCompanyId: string,
  ): Promise<boolean> {
    const linkedMatches =
      inv?.orders?.some(
        (o: any) => o?.customerCompanyId === customerCompanyId,
      ) ?? false;
    if (linkedMatches) return true;

    const snap = inv?.snapshot as any;
    const snapshotOrderIds = Array.isArray(snap?.orderIds)
      ? (snap.orderIds as string[])
      : [];
    if (!snapshotOrderIds.length) return false;

    const order = await this.prisma.transportOrder.findFirst({
      where: {
        tenantId,
        id: { in: snapshotOrderIds },
        customerCompanyId,
      },
      select: { id: true },
    });
    return Boolean(order);
  }

  private async assertCanAccessInvoice(tenantId: string, inv: any, user: any) {
    if (user?.role !== Role.CUSTOMER) return;
    const customerCompanyId = this.getCustomerCompanyIdOrThrow(user);
    const allowed = await this.invoiceBelongsToCustomerCompany(
      tenantId,
      inv,
      customerCompanyId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not allowed to access this invoice");
    }
  }

  async listInvoices(
    tenantId: string,
    query?: {
      q?: string;
      filter?: string;
      sortBy?: string;
      sortDir?: string;
      page?: unknown;
      pageSize?: unknown;
    },
    user?: any,
  ): Promise<{
    data: any[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(
      query ?? {},
    );

    const where: any = { tenantId };
    const isCustomer = user?.role === Role.CUSTOMER;
    const customerCompanyId = isCustomer
      ? this.getCustomerCompanyIdOrThrow(user)
      : null;
    applyQSearch(where, query?.q?.trim(), ["invoiceNo", "customerName"]);
    applyMappedFilter(where, query?.filter, {
      Draft: { status: "Draft" },
      Sent: { status: "Sent" },
      Paid: { status: "Paid" },
      Void: { status: "Void" },
    });

    const orderBy = buildOrderBy(
      query?.sortBy,
      query?.sortDir,
      [
        "createdAt",
        "updatedAt",
        "invoiceNo",
        "status",
        "issueDate",
        "issuedAt",
      ],
      { createdAt: "desc" },
    );

    const include = {
      lineItems: true,
      orders: { select: { id: true } },
    };

    if (!isCustomer) {
      const [total, invoices] = await this.prisma.$transaction([
        this.prisma.invoice.count({ where }),
        this.prisma.invoice.findMany({
          where,
          orderBy,
          skip,
          take,
          include,
        }),
      ]);

      const data = await Promise.all(
        invoices.map((inv) => this.toDtoWithNames(inv)),
      );
      return { data, meta: buildPaginationMeta(page, pageSize, total) };
    }

    // CUSTOMER visibility is company-scoped and derived from invoice orders
    // and/or draft snapshot.orderIds (for unlinked draft scenarios).
    const customerCandidates = await this.prisma.invoice.findMany({
      where,
      orderBy,
      include: {
        lineItems: true,
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    const visible: any[] = [];
    for (const inv of customerCandidates) {
      const allowed = await this.invoiceBelongsToCustomerCompany(
        tenantId,
        inv,
        customerCompanyId as string,
      );
      if (allowed) visible.push(inv);
    }

    const total = visible.length;
    const pageItems = visible.slice(skip, skip + take);
    const data = await Promise.all(pageItems.map((inv) => this.toDtoWithNames(inv)));
    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  async getInvoice(tenantId: string, id: string, user: any) {
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id },
      include: {
        lineItems: true,
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    if (!inv) throw new BadRequestException("Invoice not found");

    await this.assertCanAccessInvoice(tenantId, inv, user);
    return this.toDtoWithNames(inv);
  }

  async createInvoice(
    tenantId: string,
    dto: CreateInvoiceDto,
    user: any,
  ): Promise<InvoiceDto> {
    this.assertCustomerCanOnlyRead(user);
    const orderIds = dto.orderIds ?? [];
    if (!orderIds.length) {
      throw new BadRequestException(
        "orderIds is required to create a non-draft invoice",
      );
    }
    // Validate orders: belong to tenant, completed-ish, and not already invoiced
    const orders = await this.prisma.transportOrder.findMany({
      where: {
        tenantId,
        id: { in: orderIds },
      },
      select: { id: true, status: true, invoiceId: true, customerName: true },
    });

    if (orders.length !== orderIds.length) {
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
        where: { tenantId, id: { in: orderIds }, invoiceId: null },
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

  private async toDtoWithNames(
    inv: any,
    fallbackOrderIds?: string[],
  ): Promise<InvoiceDto> {
    const snap = inv.snapshot as any;
    const meta = extractDraftMeta(snap);

    const confirmedByUserId = meta.confirmedByUserId;
    const markedAsSentByUserId = inv.issuedByUserId ?? null;

    const userIds = [confirmedByUserId, markedAsSentByUserId].filter(
      Boolean,
    ) as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

    const nameById = new Map<string, string>(
      users.map((u) => [u.id, u.name ?? u.email ?? u.id]),
    );

    const orderIds = inv.orders?.length
      ? inv.orders.map((o: any) => o.id)
      : (fallbackOrderIds ?? meta.orderIds);

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
      confirmedByName: confirmedByUserId
        ? (nameById.get(confirmedByUserId) ?? null)
        : null,

      markedAsSentAt: inv.issuedAt ?? null,
      markedAsSentByUserId: markedAsSentByUserId,
      markedAsSentByName: markedAsSentByUserId
        ? (nameById.get(markedAsSentByUserId) ?? null)
        : null,

      pdfKey: inv.pdfKey ?? null,
      pdfGeneratedAt: inv.pdfGeneratedAt ?? null,
    };
  }

  async createDraftInvoice(
    tenantId: string,
    dto: CreateInvoiceDto,
    user: any,
  ): Promise<InvoiceDto> {
    this.assertCustomerCanOnlyRead(user);
    const confirmedByUserId: string | null = user?.userId ?? null;
    const orderIds = dto.orderIds ?? [];

    // Draft invoices may be created without any orders/jobs.
    const orders =
      orderIds.length > 0
        ? await this.prisma.transportOrder.findMany({
            where: { tenantId, id: { in: orderIds } },
            select: {
              id: true,
              status: true,
              invoiceId: true,
              customerName: true,
            },
          })
        : [];

    if (orderIds.length > 0 && orders.length !== orderIds.length) {
      throw new BadRequestException("Some orders not found under this tenant");
    }

    if (orders.length > 0) {
      const bad = orders.find(
        (o) =>
          o.invoiceId ||
          ![OrderStatus.Delivered, OrderStatus.Closed].includes(o.status),
      );
      if (bad) {
        throw new BadRequestException(
          "Orders must be Delivered/Closed and not already invoiced",
        );
      }
    }

    const normalized = dto.lineItems.map((l) => {
      const amountCents = l.qty * l.unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return { ...l, amountCents, taxCents, taxRate: toBasisPoints(l.taxRate) };
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
          orderIds,
          confirmedAt: new Date().toISOString(),
          confirmedByUserId: confirmedByUserId ?? null,
        },
      },
      include: {
        lineItems: true,
        orders: { select: { id: true } }, // empty until "Sent"
      },
    });

    // Return orderIds from dto since orders aren't linked yet.
    // PDF: generated on the client and uploaded via POST .../pdf.
    return this.toDtoWithNames(created, orderIds);
  }

  async issueInvoice(tenantId: string, invoiceId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const issuedByUserId: string | null = user?.userId ?? null;
    const issuedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { lineItems: true },
      });

      if (!inv) throw new BadRequestException("Invoice not found");
      if (inv.status !== "Draft")
        throw new BadRequestException("Invoice is not Draft");

      const rawOrderIds = (inv.snapshot as any)?.orderIds;
      const orderIds: string[] = Array.isArray(rawOrderIds)
        ? rawOrderIds
        : [];

      let orders: Array<{
        id: string;
        orderRef: string;
        internalRef: string | null;
        priceCents: number | null;
      }> = [];

      if (orderIds.length > 0) {
        // Re-validate eligibility and link transport orders to this invoice.
        const found = await tx.transportOrder.findMany({
          where: { tenantId, id: { in: orderIds } },
          select: {
            id: true,
            status: true,
            invoiceId: true,
            orderRef: true,
            internalRef: true,
            priceCents: true,
          },
        });

        if (found.length !== orderIds.length) {
          throw new BadRequestException("Some orders no longer exist");
        }

        const bad = found.find(
          (o) => o.invoiceId || o.status !== OrderStatus.Delivered,
        );
        if (bad) {
          throw new BadRequestException(
            "Some orders are no longer eligible to invoice",
          );
        }

        const updated = await tx.transportOrder.updateMany({
          where: { tenantId, id: { in: orderIds }, invoiceId: null },
          data: { invoiceId: inv.id, status: OrderStatus.Closed },
        });

        if (updated.count !== orderIds.length) {
          throw new BadRequestException(
            "Some orders were invoiced by someone else",
          );
        }

        orders = found;
      }

      const finalSnapshot = {
        stage: "Sent",
        orderIds,
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
          sentAt: new Date(),
          sentByUserId: issuedByUserId ?? null,
        },
        include: { lineItems: true, orders: { select: { id: true } } },
      });

      return locked;
    });

    // Invoice PDF is generated on the frontend and uploaded via POST .../pdf.
    return this.toDtoWithNames(result);
  }

  async revertInvoiceToDraft(tenantId: string, invoiceId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const userId: string | null = user?.userId ?? null;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { orders: { select: { id: true } }, lineItems: true },
      });

      if (!inv) throw new BadRequestException("Invoice not found");
      if (inv.status !== "Sent")
        throw new BadRequestException("Only Sent invoices can be reverted");

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
        confirmedAt: draftMeta.confirmedAt
          ? draftMeta.confirmedAt.toISOString()
          : (prevSnap?.confirmedAt ?? null),
        confirmedByUserId:
          draftMeta.confirmedByUserId ?? prevSnap?.confirmedByUserId ?? null,
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
    const snapshotOrderIds = Array.isArray(snap?.orderIds) ? snap.orderIds : [];
    return await this.toDtoWithNames(updated, snapshotOrderIds);
  }

  // Update an existing Draft invoice: replaces line items; snapshot orderIds are
  // optional (omit dto.orderIds to keep existing; send [] to clear).
  // NOTE: Sent invoices must be reverted first.
  async updateDraftInvoice(
    tenantId: string,
    invoiceId: string,
    dto: CreateInvoiceDto,
    user: any,
  ): Promise<InvoiceDto> {
    this.assertCustomerCanOnlyRead(user);
    const updatedByUserId: string | null = user?.userId ?? null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { lineItems: true, orders: { select: { id: true } } },
      });

      if (!inv) throw new BadRequestException("Invoice not found");
      if (inv.status !== "Draft") {
        throw new BadRequestException("Only Draft invoices can be updated");
      }

      const prevSnapEarly = inv.snapshot as any;
      const existingOrderIds = Array.isArray(prevSnapEarly?.orderIds)
        ? (prevSnapEarly.orderIds as string[])
        : [];
      // Optional: omit orderIds on PATCH to keep current snapshot; send [] to clear.
      const orderIds =
        dto.orderIds !== undefined ? (dto.orderIds ?? []) : existingOrderIds;

      // Validate orders only when orderIds are provided.
      const orders =
        orderIds.length > 0
          ? await tx.transportOrder.findMany({
              where: { tenantId, id: { in: orderIds } },
              select: { id: true, status: true, invoiceId: true },
            })
          : [];

      if (orderIds.length > 0 && orders.length !== orderIds.length) {
        throw new BadRequestException(
          "Some orders not found under this tenant",
        );
      }

      if (orders.length > 0) {
        const bad = orders.find(
          (o) =>
            o.invoiceId ||
            ![OrderStatus.Delivered, OrderStatus.Closed].includes(
              o.status as any,
            ),
        );
        if (bad) {
          throw new BadRequestException(
            "Orders must be Delivered/Closed and not already invoiced",
          );
        }
      }

      // Compute totals from manual line items
      const normalized = dto.lineItems.map((l) => {
        const amountCents = l.qty * l.unitPriceCents;
        const taxCents =
          l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
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
        : inv.issueDate;

      const dueDate = dto.dueDateISO
        ? new Date(dto.dueDateISO + "T00:00:00")
        : null;

      const prevSnap = inv.snapshot as any;
      const draftMeta = extractDraftMeta(prevSnap);

      const nextSnapshot = {
        ...(prevSnap ?? {}),
        stage: "Draft",
        orderIds,
        confirmedAt:
          draftMeta.confirmedAt?.toISOString() ?? prevSnap?.confirmedAt ?? null,
        confirmedByUserId:
          draftMeta.confirmedByUserId ?? prevSnap?.confirmedByUserId ?? null,
        updatedAt: new Date().toISOString(),
        updatedByUserId: updatedByUserId ?? null,
      };

      // Replace line items (simple + safe)
      await tx.invoiceLineItem.deleteMany({
        where: { tenantId, invoiceId: inv.id },
      });

      const inv2 = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          customerName: dto.customerName,
          currency: dto.currency ?? inv.currency,
          issueDate,
          dueDate,
          notes: dto.notes ?? null,
          subtotalCents,
          taxCents,
          totalCents,
          snapshot: nextSnapshot,
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
        include: { lineItems: true, orders: { select: { id: true } } },
      });

      return inv2;
    });

    // Draft has no linked orders; return with snapshot orderIds.
    // PDF: regenerated on the client after edits; upload via POST .../pdf.
    const snap = updated.snapshot as any;
    const snapshotOrderIds = Array.isArray(snap?.orderIds) ? snap.orderIds : [];
    return this.toDtoWithNames(updated, snapshotOrderIds);
  }

  async uploadInvoicePdf(
    tenantId: string,
    invoiceId: string,
    file: Express.Multer.File,
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);

    if (file.mimetype !== "application/pdf") {
      throw new BadRequestException("Only PDF files are allowed");
    }

    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: {
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    if (!inv) {
      throw new BadRequestException("Invoice not found");
    }

    await this.assertCanAccessInvoice(tenantId, inv, user);

    const safeInvoiceNo = this.safeFileName(
      inv.invoiceNo || `invoice-${inv.id}`,
    );
    const fileName = `${safeInvoiceNo}.pdf`;
    const storageKey = `${tenantId}/invoices/${invoiceId}/${Date.now()}-${fileName}`;

    const supabase = this.supabaseService.getClient();

    if (inv.pdfKey) {
      await supabase.storage
        .from(this.INVOICE_PDFS_BUCKET)
        .remove([inv.pdfKey]);
    }

    const { error: uploadError } = await supabase.storage
      .from(this.INVOICE_PDFS_BUCKET)
      .upload(storageKey, file.buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new BadRequestException(
        `Failed to upload invoice PDF: ${uploadError.message}`,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id: inv.id },
      data: {
        pdfKey: storageKey,
        pdfGeneratedAt: new Date(),
      },
      include: {
        lineItems: true,
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    return this.toDtoWithNames(updated);
  }

  async getInvoicePdfDownloadUrl(
    tenantId: string,
    invoiceId: string,
    user: any,
  ) {
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: {
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    if (!inv) {
      throw new BadRequestException("Invoice not found");
    }

    await this.assertCanAccessInvoice(tenantId, inv, user);

    if (!inv.pdfKey) {
      throw new BadRequestException("Invoice PDF has not been uploaded yet");
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .storage.from(this.INVOICE_PDFS_BUCKET)
      .createSignedUrl(inv.pdfKey, this.PDF_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      throw new BadRequestException(
        `Failed to create invoice download URL: ${error?.message ?? "unknown error"}`,
      );
    }

    return {
      url: data.signedUrl,
      fileName: `${this.safeFileName(inv.invoiceNo || "invoice")}.pdf`,
      expiresInSeconds: this.PDF_SIGNED_URL_TTL_SECONDS,
    };
  }
}
