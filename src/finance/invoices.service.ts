import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { InvoicePrefillResponseDto } from "./dto/invoice.dto";
import { PortalInvoiceDto } from "./dto/portal-invoice.dto";
import { JobStatus, OrderStatus, Role, TripStatus } from "@prisma/client";
import { SupabaseService } from "../auth/supabase.service";
import { AuditService } from "../audit/audit.service";
import { loadInvoiceAssetBuffer, renderInvoiceHtml } from "./invoice-render";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { evaluateJobInvoiceReadiness } from "../ops/job-invoice-readiness";

function toBasisPoints(rate: number) {
  return Math.round(rate);
}

function extractDraftMeta(snapshot: any) {
  const s = snapshot ?? {};
  return {
    orderIds: Array.isArray(s.orderIds) ? (s.orderIds as string[]) : [],
    sourceJobIds: Array.isArray(s.sourceJobIds)
      ? (s.sourceJobIds as string[])
      : [],
    confirmedAt: s.confirmedAt ? new Date(s.confirmedAt) : null,
    confirmedByUserId: s.confirmedByUserId ?? null,
  };
}

function normalizeCustomerCompanyName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private supabaseService: SupabaseService,
    private readonly audit: AuditService,
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

  private toIsoDateOnly(d: Date): string {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }

  private computeInvoiceTotals(lineItems: Array<{
    qty: number;
    unitPriceCents: number;
    taxRate: number;
  }>) {
    const normalized = lineItems.map((l) => {
      const amountCents = l.qty * l.unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return { ...l, amountCents, taxCents };
    });
    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;
    return { normalized, subtotalCents, taxCents, totalCents };
  }

  private async resolveQuotationOptionsForCompany(
    tenantId: string,
    companyId: string,
  ): Promise<Array<{
    id: string;
    code: string;
    label: string;
    description: string | null;
    unit: string | null;
    rateCents: number | null;
    unitPriceCents: number | null;
    requiresManualAmount: boolean;
    taxRate: number;
    rawRateText: string | null;
    sourceMasterFileId: string | null;
  }>> {
    const rateMasterLines = await this.prisma.customerRateMasterLine.findMany({
      where: {
        tenantId,
        customerCompanyId: companyId,
        active: true,
        isSelectableForJob: true,
      },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    });

    if (rateMasterLines.length > 0) {
      return rateMasterLines.map((r: any) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        description: r.description ?? null,
        unit: r.unit ?? null,
        rateCents: r.rateCents ?? null,
        unitPriceCents: r.rateCents ?? null,
        requiresManualAmount: Boolean(r.requiresManualAmount || r.rateCents == null),
        taxRate: 0.09,
        rawRateText: r.rawRateText ?? null,
        sourceMasterFileId: null,
      }));
    }

    const fallback = await this.prisma.customerQuotationRateLine.findMany({
      where: {
        tenantId,
        quotation: {
          customerCompanyId: companyId,
          status: "ACTIVE",
        },
      },
      include: {
        quotation: { select: { id: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });

    return fallback.map((r: any) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      description: r.description ?? null,
      unit: r.unit ?? null,
      rateCents: r.rateCents ?? null,
      unitPriceCents: r.rateCents ?? null,
      requiresManualAmount: Boolean(r.requiresManualAmount || r.rateCents == null),
      taxRate: 0.09,
      rawRateText: r.rawRateText ?? null,
      sourceMasterFileId: r.quotation?.id ?? null,
    }));
  }

  async listQuotationOptionsByCompany(tenantId: string, companyId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException("Customer company not found");
    const items = await this.resolveQuotationOptionsForCompany(tenantId, companyId);
    return { items };
  }

  async listInvoiceableJobsByCompany(tenantId: string, companyId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException("Customer company not found");

    const jobs = await this.prisma.job.findMany({
      where: {
        tenantId,
        customerCompanyId: companyId,
        status: { not: JobStatus.CANCELLED },
      },
      include: {
        trips: { select: { id: true, status: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const items: any[] = [];
    for (const job of jobs) {
      const readiness = evaluateJobInvoiceReadiness(
        (job.trips ?? []).map((t: any) => ({ id: t.id, status: t.status as TripStatus })),
      );
      if (!readiness.readyForInvoice) continue;

      const existingInvoice = await this.prisma.invoice.findFirst({
        where: { tenantId, sourceJobId: job.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });
      if (existingInvoice && !["Draft"].includes(existingInvoice.status)) {
        continue;
      }

      const completedTripCount = (job.trips ?? []).filter((t: any) =>
        t.status === TripStatus.COMPLETED || t.status === TripStatus.DONE).length;

      items.push({
        id: job.id,
        internalJobReference: job.internalRef,
        customerReference: job.externalRef ?? null,
        jobType: job.jobType,
        status: job.status,
        invoiceReadyAt: job.invoiceReadyAt ?? null,
        tripCount: (job.trips ?? []).length,
        completedTripCount,
        existingInvoiceId: existingInvoice?.id ?? null,
        existingInvoiceStatus: existingInvoice?.status ?? null,
        label: `${job.internalRef} · ${job.externalRef ?? "-"} · ${job.jobType}`,
      });
    }
    return { items };
  }

  private async validateInvoiceLineSources(
    tenantId: string,
    customerCompanyId: string | null,
    sourceJobId: string | null,
    lineItems: Array<any>,
  ): Promise<void> {
    for (const line of lineItems) {
      const sourceType = String(line.sourceType ?? "MANUAL").toUpperCase();
      if (!["MANUAL", "JOB", "QUOTATION_MASTER"].includes(sourceType)) {
        throw new BadRequestException(`Unsupported sourceType: ${sourceType}`);
      }
      if (sourceType === "QUOTATION_MASTER") {
        if (!line.sourceMasterItemId) {
          throw new BadRequestException("sourceMasterItemId is required for QUOTATION_MASTER");
        }
        const companyId = customerCompanyId ?? (
          sourceJobId
            ? (await this.prisma.job.findFirst({
              where: { id: sourceJobId, tenantId },
              select: { customerCompanyId: true },
            }))?.customerCompanyId ?? null
            : null
        );
        if (!companyId) {
          throw new BadRequestException("customerCompanyId is required for quotation master validation");
        }
        const inRateMaster = await this.prisma.customerRateMasterLine.findFirst({
          where: {
            id: line.sourceMasterItemId,
            tenantId,
            customerCompanyId: companyId,
            active: true,
            isSelectableForJob: true,
          },
          select: { id: true },
        });
        if (!inRateMaster) {
          const inQuotation = await this.prisma.customerQuotationRateLine.findFirst({
            where: {
              id: line.sourceMasterItemId,
              tenantId,
              quotation: {
                customerCompanyId: companyId,
                status: "ACTIVE",
              },
            },
            select: { id: true },
          });
          if (!inQuotation) {
            throw new BadRequestException("Invalid quotation source line item");
          }
        }
      }
      if (sourceType === "JOB" && !sourceJobId) {
        throw new BadRequestException("sourceJobId is required for JOB line items");
      }
    }
  }

  async getInvoicePrefillFromJob(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<InvoicePrefillResponseDto> {
    this.assertCustomerCanOnlyRead(user);
    const job = await this.prisma.job.findFirst({
      where: { tenantId, id: jobId },
      include: {
        customerCompany: true,
        trips: { select: { id: true, status: true, displayTitle: true } },
      },
    });
    if (!job) throw new BadRequestException("Job not found");
    if (
      job.status !== JobStatus.READY_FOR_INVOICE &&
      !job.invoiceReadyAt
    ) {
      throw new BadRequestException("Job is not ready for invoice");
    }

    const existingGenerated = await this.prisma.invoice.findFirst({
      where: {
        tenantId,
        sourceJobId: jobId,
        status: { in: ["Sent", "Issued", "Paid"] },
      },
      select: { id: true },
    });
    if (existingGenerated) {
      throw new BadRequestException("Invoice already generated for this job");
    }

    const existingDraft = await this.prisma.invoice.findFirst({
      where: { tenantId, sourceJobId: jobId, status: "Draft" },
      include: { lineItems: true },
      orderBy: { createdAt: "desc" },
    });

    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + 14);
    const taxRate = 900;
    const quotationOptions = await this.resolveQuotationOptionsForCompany(
      tenantId,
      job.customerCompanyId,
    );

    if (existingDraft) {
      const amountDueCents = existingDraft.totalCents;
      return {
        jobId,
        internalJobReference: job.internalRef,
        customerCompanyId: job.customerCompanyId,
        customerCompanyName: job.customerCompany?.name ?? "Customer",
        invoiceTemplate: (existingDraft as any).templateCode ?? "DB_WISDOM",
        invoiceDate: this.toIsoDateOnly(existingDraft.issueDate),
        dueDate: this.toIsoDateOnly(existingDraft.dueDate ?? due),
        reference: `${job.internalRef}${job.externalRef ? ` // ${job.externalRef}` : ""}`,
        currency: existingDraft.currency ?? "SGD",
        taxRate: taxRate / 10000,
        lineItems: existingDraft.lineItems.map((li: any) => ({
          description: li.description,
          qty: li.qty,
          unitPriceCents: li.unitPriceCents,
          taxCode: li.taxCode,
          taxRate: li.taxRate,
          sourceType: li.sourceType ?? "MANUAL",
          sourceMasterItemId: li.sourceMasterItemId ?? null,
          requiresManualAmount: li.requiresManualAmount ?? false,
        })),
        subtotalCents: existingDraft.subtotalCents,
        taxCents: existingDraft.taxCents,
        totalCents: existingDraft.totalCents,
        amountDueCents,
        existingDraftInvoiceId: existingDraft.id,
        quotationOptions,
      };
    }

    const templateCode = "WISDOM_FORCE";
    const sourceLines = quotationOptions;

    const prefillLineItems: Array<any> = [
      {
        sourceType: "JOB",
        sourceMasterItemId: null,
        description: `${job.internalRef} - Job billing`,
        qty: 1,
        unitPriceCents: 0,
        taxCode: "SR",
        taxRate,
        requiresManualAmount: true,
      },
      ...sourceLines.map((r: any) => ({
        sourceType: "QUOTATION_MASTER",
        sourceMasterItemId: r.id,
        description: `${r.code} - ${r.label}`,
        qty: 1,
        unitPriceCents: r.unitPriceCents ?? 0,
        taxCode: "SR",
        taxRate,
        requiresManualAmount: Boolean(r.requiresManualAmount || r.unitPriceCents == null),
      })),
    ];

    const totals = this.computeInvoiceTotals(prefillLineItems);

    return {
      jobId,
      internalJobReference: job.internalRef,
      customerCompanyId: job.customerCompanyId,
      customerCompanyName: job.customerCompany?.name ?? "Customer",
      invoiceTemplate: templateCode,
      invoiceDate: this.toIsoDateOnly(today),
      dueDate: this.toIsoDateOnly(due),
      reference: `${job.internalRef}${job.externalRef ? ` // ${job.externalRef}` : ""}`,
      currency: "SGD",
      taxRate: taxRate / 10000,
      lineItems: prefillLineItems,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      amountDueCents: totals.totalCents,
      existingDraftInvoiceId: null,
      quotationOptions,
    };
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

    await this.validateInvoiceLineSources(
      tenantId,
      dto.customerCompanyId ?? null,
      dto.sourceJobId ?? null,
      dto.lineItems ?? [],
    );

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
          customerCompanyId: dto.customerCompanyId ?? null,
          sourceJobId: dto.sourceJobId ?? null,
          templateCode: dto.templateCode ?? "DB_WISDOM",
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
              sourceType: (l as any).sourceType ?? "MANUAL",
              sourceMasterItemId: (l as any).sourceMasterItemId ?? null,
              requiresManualAmount: Boolean((l as any).requiresManualAmount),
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

    const sourceJobIds = meta.sourceJobIds?.length ? meta.sourceJobIds : [];

    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      customerName: inv.customerName,
      customerCompanyId: (inv as any).customerCompanyId ?? null,
      sourceJobId: (inv as any).sourceJobId ?? null,
      templateCode: (inv as any).templateCode ?? "DB_WISDOM",
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
        sourceType: l.sourceType ?? null,
        sourceMasterItemId: l.sourceMasterItemId ?? null,
        requiresManualAmount: l.requiresManualAmount ?? false,
      })),
      orderIds,
      sourceJobIds,

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

  async getInvoiceDraftFromJobs(
    tenantId: string,
    jobIds: string[],
    user: any,
  ): Promise<{
    customerName: string;
    currency: string;
    sourceJobIds: string[];
    suggestedLineItems: Array<{
      description: string;
      qty: number;
      unitPriceCents: number;
      taxCode: string;
      taxRate: number;
    }>;
  }> {
    this.assertCustomerCanOnlyRead(user);
    if (!jobIds?.length) {
      throw new BadRequestException("jobIds is required");
    }

    const jobs = await this.prisma.job.findMany({
      where: { tenantId, id: { in: jobIds } },
      include: {
        customerCompany: { select: { id: true, name: true } },
        charges: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    if (jobs.length !== jobIds.length) {
      throw new BadRequestException("Some jobs not found under this tenant");
    }

    const companySet = new Set(jobs.map((j) => j.customerCompanyId));
    if (companySet.size !== 1) {
      throw new BadRequestException(
        "All jobs must belong to the same customer company for one invoice draft",
      );
    }

    const company = jobs[0].customerCompany;
    const suggestedLineItems: Array<{
      description: string;
      qty: number;
      unitPriceCents: number;
      taxCode: string;
      taxRate: number;
    }> = [];

    const jobsNotInvoiceReady = jobs
      .filter(
        (j) =>
          j.status !== JobStatus.READY_FOR_INVOICE &&
          !j.invoiceReadyAt,
      )
      .map((j) => j.internalRef || j.id);
    if (jobsNotInvoiceReady.length > 0) {
      throw new BadRequestException(
        `Selected jobs must be sent to invoice by ops first. Not ready: ${jobsNotInvoiceReady.join(", ")}`,
      );
    }

    const jobsWithoutCharges = jobs
      .filter((j) => !j.charges || j.charges.length === 0)
      .map((j) => j.internalRef || j.id);
    if (jobsWithoutCharges.length > 0) {
      throw new BadRequestException(
        `Selected jobs must have saved JobCharge rows before invoicing. Missing charges for: ${jobsWithoutCharges.join(", ")}`,
      );
    }

    for (const job of jobs) {
      for (const c of job.charges ?? []) {
        const taxCode = c.taxable ? c.taxCode || "SR" : "ZR";
        const taxRate = c.taxRateBasisPoints ?? (c.taxable ? 900 : 0);
        suggestedLineItems.push({
          description: `${job.internalRef} — ${c.label}`,
          qty: c.qty,
          unitPriceCents: c.unitPriceCents,
          taxCode,
          taxRate,
        });
      }
    }

    await this.audit.log(
      tenantId,
      "INVOICE_DRAFT_FROM_JOBS",
      "TENANT",
      tenantId,
      { jobIds, lineCount: suggestedLineItems.length },
      user?.userId ?? null,
    );

    return {
      customerName: company?.name ?? jobs[0].receiverName ?? "Customer",
      currency: "SGD",
      sourceJobIds: jobIds,
      suggestedLineItems,
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

    await this.validateInvoiceLineSources(
      tenantId,
      dto.customerCompanyId ?? null,
      dto.sourceJobId ?? null,
      dto.lineItems ?? [],
    );

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
        customerCompanyId: dto.customerCompanyId ?? null,
        sourceJobId: dto.sourceJobId ?? null,
        templateCode: dto.templateCode ?? "DB_WISDOM",
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
            sourceType: (l as any).sourceType ?? "MANUAL",
            sourceMasterItemId: (l as any).sourceMasterItemId ?? null,
            requiresManualAmount: Boolean((l as any).requiresManualAmount),
          })),
        },
        snapshot: {
          stage: "Draft",
          orderIds,
          sourceJobIds: dto.sourceJobIds ?? [],
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

      const sourceJobIds: string[] = Array.isArray((inv.snapshot as any)?.sourceJobIds)
        ? ((inv.snapshot as any).sourceJobIds as string[])
        : [];
      if (sourceJobIds.length > 0) {
        await tx.job.updateMany({
          where: {
            tenantId,
            id: { in: sourceJobIds },
            status: JobStatus.READY_FOR_INVOICE,
          },
          data: {
            status: JobStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
      }

      const finalSnapshot = {
        stage: "Sent",
        orderIds,
        sourceJobIds,
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
      const existingSourceJobIds = Array.isArray(prevSnapEarly?.sourceJobIds)
        ? (prevSnapEarly.sourceJobIds as string[])
        : [];
      // Optional: omit orderIds on PATCH to keep current snapshot; send [] to clear.
      const orderIds =
        dto.orderIds !== undefined ? (dto.orderIds ?? []) : existingOrderIds;
      const sourceJobIds =
        dto.sourceJobIds !== undefined
          ? (dto.sourceJobIds ?? [])
          : existingSourceJobIds;

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

      await this.validateInvoiceLineSources(
        tenantId,
        dto.customerCompanyId ?? (inv as any).customerCompanyId ?? null,
        dto.sourceJobId ?? (inv as any).sourceJobId ?? null,
        dto.lineItems ?? [],
      );

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
        sourceJobIds,
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
          customerCompanyId: dto.customerCompanyId ?? (inv as any).customerCompanyId ?? null,
          sourceJobId: dto.sourceJobId ?? (inv as any).sourceJobId ?? null,
          templateCode: dto.templateCode ?? (inv as any).templateCode ?? "DB_WISDOM",
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
              sourceType: (l as any).sourceType ?? "MANUAL",
              sourceMasterItemId: (l as any).sourceMasterItemId ?? null,
              requiresManualAmount: Boolean((l as any).requiresManualAmount),
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

  private async buildInvoiceRenderData(tenantId: string, inv: any) {
    const company = (inv as any).customerCompanyId
      ? await this.prisma.customer_companies.findFirst({
        where: {
          id: (inv as any).customerCompanyId,
          tenantId,
        },
      })
      : null;
    const sourceJob = (inv as any).sourceJobId
      ? await this.prisma.job.findFirst({
        where: { id: (inv as any).sourceJobId, tenantId },
        select: { id: true, internalRef: true, externalRef: true },
      })
      : null;
    const taxRate = inv.lineItems?.[0]?.taxRate ?? 900;
    const currency = inv.currency ?? "SGD";
    const billingAddress = company?.billingSameAsAddress
      ? [company?.addressLine1, company?.addressLine2, company?.postalCode, company?.country]
      : [company?.billingAddressLine1, company?.billingAddressLine2, company?.billingPostalCode, company?.billingCountry];
    const reference = sourceJob?.internalRef
      ? `${sourceJob.internalRef}${sourceJob.externalRef ? ` // ${sourceJob.externalRef}` : ""}`
      : null;
    return {
      invoiceNo: inv.invoiceNo,
      templateCode: (inv as any).templateCode ?? "DB_WISDOM",
      sellerName: "Wisdom Force Logistics Pte Ltd",
      sellerUen: "202606497W",
      sellerAddress: "Singapore",
      customerName: inv.customerName,
      customerBillingAddress: billingAddress.filter(Boolean).join(", "),
      issueDateISO: this.toIsoDateOnly(inv.issueDate),
      dueDateISO: inv.dueDate ? this.toIsoDateOnly(inv.dueDate) : null,
      reference,
      currency,
      taxRatePercent: taxRate / 100,
      lines: (inv.lineItems ?? []).map((li: any) => ({
        description: li.description,
        qty: li.qty,
        unitPriceCents: li.unitPriceCents,
        amountCents: li.amountCents,
        taxLabel: li.taxRate > 0 ? `${(li.taxRate / 100).toFixed(2)}%` : "0%",
      })),
      subtotalCents: inv.subtotalCents,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
      amountPaidCents: 0,
      amountDueCents: inv.totalCents,
      paymentInstructions: inv.notes ?? null,
      sourceJobInternalRef: sourceJob?.internalRef ?? null,
      sourceJobId: sourceJob?.id ?? null,
      customerCompanyId: company?.id ?? null,
    };
  }

  private async createInvoicePdfBuffer(renderData: any): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoBytes = loadInvoiceAssetBuffer("WF-logo.jpeg");
    const qrBytes = loadInvoiceAssetBuffer("WF-QR.jpeg");
    let y = 804;
    if (logoBytes) {
      try {
        const logo = await pdfDoc.embedJpg(logoBytes);
        const w = 170;
        const h = (logo.height / logo.width) * w;
        page.drawImage(logo, { x: 40, y: y - h + 6, width: w, height: h });
      } catch {
        // non-fatal fallback to text header
      }
    } else {
      page.drawText("WISDOM FORCE LOGISTICS PTE LTD", { x: 40, y: y - 10, size: 11, font: bold });
    }

    page.drawText("TAX INVOICE", { x: 390, y: 802, size: 18, font: bold });
    page.drawText(`Invoice No: ${renderData.invoiceNo}`, { x: 390, y: 782, size: 10, font });
    page.drawText(`Invoice Date: ${renderData.issueDateISO}`, { x: 390, y: 768, size: 10, font });
    page.drawText(`Due Date: ${renderData.dueDateISO ?? "-"}`, { x: 390, y: 754, size: 10, font });
    page.drawText(`Reference: ${renderData.reference ?? "-"}`, { x: 390, y: 740, size: 10, font });

    y = 708;
    page.drawText("Bill To", { x: 40, y, size: 11, font: bold });
    y -= 14;
    page.drawText(String(renderData.customerName ?? ""), { x: 40, y, size: 10, font: bold });
    y -= 13;
    page.drawText(String(renderData.customerBillingAddress ?? ""), { x: 40, y, size: 10, font });

    y = 652;
    page.drawText("Description", { x: 40, y, size: 10, font: bold });
    page.drawText("Qty", { x: 350, y, size: 10, font: bold });
    page.drawText("Unit Price", { x: 390, y, size: 10, font: bold });
    page.drawText("Tax", { x: 470, y, size: 10, font: bold });
    page.drawText("Amount SGD", { x: 515, y, size: 10, font: bold });
    y -= 8;
    page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.8 });

    for (const line of renderData.lines.slice(0, 18)) {
      y -= 14;
      const amount = (Number(line.amountCents || 0) / 100).toFixed(2);
      const unit = (Number(line.unitPriceCents || 0) / 100).toFixed(2);
      page.drawText(String(line.description).slice(0, 54), { x: 40, y, size: 9.5, font });
      page.drawText(String(line.qty), { x: 355, y, size: 9.5, font });
      page.drawText(unit, { x: 396, y, size: 9.5, font });
      page.drawText(String(line.taxLabel ?? ""), { x: 472, y, size: 9.5, font });
      page.drawText(amount, { x: 516, y, size: 9.5, font });
    }
    y -= 10;
    page.drawLine({ start: { x: 340, y }, end: { x: 555, y }, thickness: 0.8 });
    y -= 14;
    const subtotal = (Number(renderData.subtotalCents || 0) / 100).toFixed(2);
    const gst = (Number(renderData.taxCents || 0) / 100).toFixed(2);
    const total = (Number(renderData.totalCents || 0) / 100).toFixed(2);
    const due = (Number(renderData.amountDueCents || 0) / 100).toFixed(2);
    page.drawText("Subtotal", { x: 370, y, size: 10, font });
    page.drawText(`SGD ${subtotal}`, { x: 500, y, size: 10, font });
    y -= 13;
    page.drawText(`GST ${renderData.taxRatePercent}%`, { x: 370, y, size: 10, font });
    page.drawText(`SGD ${gst}`, { x: 500, y, size: 10, font });
    y -= 13;
    page.drawText("Invoice Total SGD", { x: 370, y, size: 10.5, font: bold });
    page.drawText(`SGD ${total}`, { x: 500, y, size: 10.5, font: bold });
    y -= 13;
    page.drawText("Total Net Payments", { x: 370, y, size: 10, font });
    page.drawText("SGD 0.00", { x: 500, y, size: 10, font });
    y -= 14;
    page.drawText("Amount Due SGD", { x: 370, y, size: 11, font: bold });
    page.drawText(`SGD ${due}`, { x: 500, y, size: 11, font: bold });

    const page2 = pdfDoc.addPage([595.28, 841.89]);
    page2.drawText("Payment Details", { x: 40, y: 790, size: 16, font: bold });
    page2.drawText(String(renderData.paymentInstructions ?? "Bank transfer / PayNow supported."), {
      x: 40,
      y: 760,
      size: 11,
      font,
    });
    page2.drawText("PayNow / SGQR", { x: 40, y: 725, size: 12, font: bold });
    page2.drawText("Scan to Pay", { x: 40, y: 708, size: 11, font });
    page2.drawText(`UEN: ${renderData.sellerUen ?? "202606497W"}`, { x: 40, y: 692, size: 11, font });
    if (qrBytes) {
      try {
        const qr = await pdfDoc.embedJpg(qrBytes);
        const w = 220;
        const h = (qr.height / qr.width) * w;
        page2.drawImage(qr, { x: 320, y: 745 - h, width: w, height: h });
      } catch {
        page2.drawText("QR unavailable", { x: 330, y: 700, size: 10, font });
      }
    } else {
      page2.drawText("QR unavailable", { x: 330, y: 700, size: 10, font });
    }
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  async getInvoicePreview(tenantId: string, invoiceId: string, user: any) {
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: { lineItems: true, orders: { select: { id: true, customerCompanyId: true } } },
    });
    if (!inv) throw new BadRequestException("Invoice not found");
    await this.assertCanAccessInvoice(tenantId, inv, user);
    const renderData = await this.buildInvoiceRenderData(tenantId, inv);
    const html = renderInvoiceHtml(renderData as any);
    return { invoiceId: inv.id, templateCode: (inv as any).templateCode ?? "DB_WISDOM", html, renderData };
  }

  async generateInvoicePdf(tenantId: string, invoiceId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: { lineItems: true, orders: { select: { id: true, customerCompanyId: true } } },
    });
    if (!inv) throw new BadRequestException("Invoice not found");
    await this.assertCanAccessInvoice(tenantId, inv, user);
    const missing = (inv.lineItems ?? []).find((li: any) =>
      li.requiresManualAmount && (!li.unitPriceCents || li.unitPriceCents <= 0));
    if (missing) throw new BadRequestException("Missing manual invoice amount");

    const renderData = await this.buildInvoiceRenderData(tenantId, inv);
    const pdfBuffer = await this.createInvoicePdfBuffer(renderData);
    const safeRef = this.safeFileName(renderData.sourceJobInternalRef || inv.invoiceNo || inv.id);
    const fileName = `${safeRef}-INVOICE.pdf`;
    const storageKey = `${tenantId}/companies/${renderData.customerCompanyId || "unknown"}/documents/${Date.now()}-${fileName}`;
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage
      .from("company-documents")
      .upload(storageKey, pdfBuffer, { contentType: "application/pdf", upsert: false });
    if (error) throw new BadRequestException(`Failed to upload invoice PDF: ${error.message}`);

    const generatedAt = new Date();
    const document = await this.prisma.customerCompanyDocument.create({
      data: {
        tenantId,
        customerCompanyId: renderData.customerCompanyId,
        type: "INVOICE",
        fileName,
        fileUrl: storageKey,
        storageKey,
        mimeType: "application/pdf",
        fileSizeBytes: pdfBuffer.length,
        uploadedByUserId: actorUserId ?? null,
        generatedByUserId: actorUserId ?? null,
        generatedAt,
        sourceJobId: renderData.sourceJobId,
        sourceInvoiceId: inv.id,
        status: "ACTIVE",
      },
      include: { generatedBy: { select: { name: true, email: true } } },
    });

    await this.prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: "Issued",
        issuedAt: generatedAt,
        issuedByUserId: actorUserId ?? null,
        pdfKey: storageKey,
        pdfGeneratedAt: generatedAt,
      },
    });

    return {
      invoiceId: inv.id,
      status: "Issued",
      document: {
        id: document.id,
        customerCompanyId: document.customerCompanyId,
        sourceJobId: document.sourceJobId,
        invoiceId: document.sourceInvoiceId,
        documentType: document.type,
        fileName: document.fileName,
        mimeType: document.mimeType,
        storageKey: document.storageKey,
        generatedByUserId: document.generatedByUserId,
        generatedByName: document.generatedBy?.name ?? document.generatedBy?.email ?? null,
        generatedAt: document.generatedAt,
        createdAt: document.createdAt,
      },
    };
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

  private buildPortalInvoiceWhere(params: {
    tenantId: string;
    invoiceId?: string;
    customerCompanyId?: string;
    requireGeneratedAt?: boolean;
  }) {
    const where: any = {
      tenantId: params.tenantId,
      ...(params.invoiceId ? { id: params.invoiceId } : {}),
      pdfKey: { not: null },
      ...(params.requireGeneratedAt ? { pdfGeneratedAt: { not: null } } : {}),
    };

    return where;
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

    if (snapshotOrderIds.length) {
      const order = await this.prisma.transportOrder.findFirst({
        where: {
          tenantId,
          id: { in: snapshotOrderIds },
          customerCompanyId,
        },
        select: { id: true },
      });
      if (order) return true;
    }

    // Fallback: match by invoice.customerName against the tenant-scoped
    // customer company. This is important for invoices that have PDFs but
    // may be missing linked orders/snapshot.orderIds.
    const normalizedInvoiceCustomerName = normalizeCustomerCompanyName(
      inv?.customerName,
    );
    if (!normalizedInvoiceCustomerName) return false;

    const company = await this.prisma.customer_companies.findFirst({
      where: {
        tenantId,
        normalizedName: normalizedInvoiceCustomerName,
      },
      select: { id: true },
    });

    return company?.id === customerCompanyId;
  }

  private async invoicePdfExists(pdfKey: string): Promise<boolean> {
    const supabase = this.supabaseService.getClient();

    const key = String(pdfKey ?? "").trim();
    if (!key) return false;

    // Most reliable existence check: try to create a signed URL for the exact key.
    // If the object does not exist, Supabase returns an error.
    try {
      const { data, error } = await supabase.storage
        .from(this.INVOICE_PDFS_BUCKET)
        .createSignedUrl(key, 60);

      return !error && !!data?.signedUrl;
    } catch {
      return false;
    }
  }

  async listPortalInvoices(
    tenantId: string,
    customerCompanyId?: string,
  ): Promise<PortalInvoiceDto[]> {
    const customerCompanyName = customerCompanyId
      ? (
          await this.prisma.customer_companies.findFirst({
            where: { id: customerCompanyId, tenantId },
            select: { name: true },
          })
        )?.name ?? ""
      : "";

    const invoices = await this.prisma.invoice.findMany({
      where: this.buildPortalInvoiceWhere({
        tenantId,
        customerCompanyId,
        // "PDF exists" is enforced by invoicePdfExists() below.
        // Do not rely on pdfGeneratedAt (older data might have null metadata).
        requireGeneratedAt: false,
      }),
      orderBy: { createdAt: "desc" },
      include: {
        orders: {
          select: {
            customerCompanyId: true,
            customerCompany: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    const results: PortalInvoiceDto[] = [];
    for (const inv of invoices as any[]) {
      if (customerCompanyId) {
        const allowed = await this.invoiceBelongsToCustomerCompany(
          tenantId,
          inv,
          customerCompanyId,
        );
        if (!allowed) continue;
      }

      const hasPdf = await this.invoicePdfExists(inv.pdfKey);
      if (!hasPdf) continue;

      const resolvedCustomerCompanyName =
        customerCompanyName || inv.orders?.[0]?.customerCompany?.name || "";

      results.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNo,
        invoiceDate: inv.issueDate,
        dueDate: inv.dueDate ?? null,
        status: inv.status,
        currency: inv.currency,
        subtotalCents: inv.subtotalCents,
        taxCents: inv.taxCents,
        totalCents: inv.totalCents,
        customerCompany: { name: resolvedCustomerCompanyName },
        hasPdf: true,
        createdAt: inv.createdAt,
      });
    }

    return results;
  }

  async downloadPortalInvoicePdf(
    tenantId: string,
    invoiceId: string,
    customerCompanyId?: string,
  ): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const inv = await this.prisma.invoice.findFirst({
      where: this.buildPortalInvoiceWhere({
        tenantId,
        invoiceId,
        customerCompanyId,
        requireGeneratedAt: false,
      }),
      select: {
        id: true,
        customerName: true,
        invoiceNo: true,
        pdfKey: true,
        snapshot: true,
        orders: { select: { customerCompanyId: true } },
      },
    });

    if (!inv?.pdfKey) {
      throw new NotFoundException("Invoice PDF not found");
    }

    if (customerCompanyId) {
      const allowed = await this.invoiceBelongsToCustomerCompany(
        tenantId,
        inv,
        customerCompanyId,
      );
      if (!allowed) {
        // Hide existence for other companies.
        throw new NotFoundException("Invoice PDF not found");
      }
    }

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(this.INVOICE_PDFS_BUCKET)
      .download(inv.pdfKey);

    if (error || !data) {
      throw new NotFoundException("Invoice PDF not found");
    }

    const raw: any = data;
    let pdfBuffer: Buffer;
    if (Buffer.isBuffer(raw)) pdfBuffer = raw;
    else if (typeof raw === "string") pdfBuffer = Buffer.from(raw);
    else if (typeof raw?.arrayBuffer === "function") {
      pdfBuffer = Buffer.from(await raw.arrayBuffer());
    } else {
      pdfBuffer = Buffer.from(raw);
    }

    const filename = `${this.safeFileName(inv.invoiceNo ?? invoiceId)}.pdf`;
    return { pdfBuffer, filename };
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
