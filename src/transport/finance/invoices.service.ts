import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
} from "../../common/pagination";
import { applyMappedFilter } from "../../common/listing/listing.filters";
import { buildOrderBy } from "../../common/listing/listing.sort";
import { applyQSearch } from "../../common/listing/listing.search";
import { CreateInvoiceDto, InvoiceDto } from "./dto/invoice.dto";
import { InvoicePrefillResponseDto } from "./dto/invoice.dto";
import { PortalInvoiceDto } from "./dto/portal-invoice.dto";
import { JobStatus, OrderStatus, Role, TripStatus } from "@prisma/client";
import { SupabaseService } from "../../shared/auth/supabase.service";
import { AuditService } from "../../shared/audit/audit.service";
import { loadInvoiceAssetBuffer, renderInvoiceHtml } from "./invoice-render";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { evaluateJobInvoiceReadiness } from "../jobs/job-invoice-readiness";
import { buildTripDisplayRef } from "../../common/trip-display-ref";
import { RealtimeEventsService } from "../../shared/realtime/realtime-events.service";
import * as rt from "../../shared/realtime/realtime-publish";

const INVOICE_DOCUMENTS_BUCKET = "invoice-documents";

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

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}
@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private supabaseService: SupabaseService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: RealtimeEventsService,
  ) {}

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
    unitPriceCents: number | null | undefined;
    taxRate: number;
  }>) {
    const normalized = lineItems.map((l) => {
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return { ...l, unitPriceCents, amountCents, taxCents };
    });
    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;
    return { normalized, subtotalCents, taxCents, totalCents };
  }

  private isBillableTripStatus(status: TripStatus): boolean {
    return status === TripStatus.COMPLETED || status === TripStatus.DONE;
  }

  private buildTripLineLabels(trip: any): { fromLabel: string; toLabel: string } {
    const fromLabel = firstText(
      trip?.originLabel,
      trip?.originAddressLine1,
      trip?.originAddressLine2,
      "Origin",
    ) as string;
    const toLabel = firstText(
      trip?.destinationLabel,
      trip?.destinationAddressLine1,
      trip?.destinationAddressLine2,
      "Destination",
    ) as string;
    return { fromLabel, toLabel };
  }

  private buildTripLineDescription(
    tripDisplayRef: string,
    fromLabel: string,
    toLabel: string,
  ): string {
    return `${tripDisplayRef}\nFrom: ${fromLabel}\nTo: ${toLabel}`;
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

    if (fallback.length > 0) {
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

    const tenantQuotationRows = await this.prisma.masterRateDatasetRow.findMany({
      where: {
        tenantId,
        isActive: true,
        dataset: {
          tenantId,
          type: "QUOTATION",
          status: "ACTIVE",
        },
      },
      include: {
        dataset: { select: { id: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });

    return tenantQuotationRows.map((r: any) => {
      const rateCents = Number.isInteger(r.rateCents) ? r.rateCents : null;
      return {
        id: r.id,
        code: String(r.code ?? "").trim(),
        label:
          firstText(
            r.label,
            r.description,
            r.code,
            "Quotation item",
          ) ?? "Quotation item",
        description: firstText(r.description, r.label) ?? null,
        unit: firstText(r.unit, "trip"),
        rateCents,
        unitPriceCents: rateCents,
        requiresManualAmount: Boolean(r.requiresManualAmount || rateCents == null),
        taxRate: 0.09,
        rawRateText: r.rawRateText ?? null,
        sourceMasterFileId: r.dataset?.id ?? null,
      };
    });
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
      const billableTripCount = completedTripCount;

      items.push({
        id: job.id,
        internalJobReference: job.internalRef,
        customerReference: job.externalRef ?? null,
        jobType: job.jobType,
        status: job.status,
        invoiceReadyAt: job.invoiceReadyAt ?? null,
        tripCount: (job.trips ?? []).length,
        completedTripCount,
        billableTripCount,
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
    const quotationOptionsCache = new Map<string, Set<string>>();
    const getQuotationOptionIds = async (companyId: string): Promise<Set<string>> => {
      const cached = quotationOptionsCache.get(companyId);
      if (cached) return cached;
      const options = await this.resolveQuotationOptionsForCompany(tenantId, companyId);
      const ids = new Set(
        (options ?? [])
          .map((item: any) => String(item?.id ?? "").trim())
          .filter(Boolean),
      );
      quotationOptionsCache.set(companyId, ids);
      return ids;
    };

    const resolveCompanyIdForLine = async (line: any): Promise<string | null> => {
      const fromLine = String(line?.customerCompanyId ?? customerCompanyId ?? "").trim();
      if (fromLine) return fromLine;
      const jobIdForCompany = String(line?.sourceJobId ?? sourceJobId ?? "").trim();
      if (!jobIdForCompany) return null;
      const job = await this.prisma.job.findFirst({
        where: { id: jobIdForCompany, tenantId },
        select: { customerCompanyId: true },
      });
      return job?.customerCompanyId ?? null;
    };

    const validateQuotationSourceItemForInvoice = async (
      line: any,
      requireSourceMaster = true,
    ): Promise<void> => {
      const sourceMasterItemId = String(line?.sourceMasterItemId ?? "").trim();
      if (!sourceMasterItemId) {
        if (requireSourceMaster) {
          throw new BadRequestException("sourceMasterItemId is required for QUOTATION_MASTER");
        }
        return;
      }
      const companyId = await resolveCompanyIdForLine(line);
      if (!companyId) {
        throw new BadRequestException(
          "customerCompanyId is required for quotation master validation",
        );
      }
      const validIds = await getQuotationOptionIds(companyId);
      if (!validIds.has(sourceMasterItemId)) {
        throw new BadRequestException("Invalid quotation source line item");
      }
    };

    for (const line of lineItems) {
      const sourceType = String(line.sourceType ?? "MANUAL").toUpperCase();
      const resolvedSourceJobId = String(line.sourceJobId ?? sourceJobId ?? "").trim() || null;
      if (!["MANUAL", "JOB", "QUOTATION_MASTER", "TRIP"].includes(sourceType)) {
        throw new BadRequestException(`Unsupported sourceType: ${sourceType}`);
      }
      if (sourceType === "QUOTATION_MASTER") {
        await validateQuotationSourceItemForInvoice(line, true);
      }
      if (sourceType === "JOB" && !resolvedSourceJobId) {
        throw new BadRequestException("sourceJobId is required for JOB line items");
      }
      if (sourceType === "TRIP") {
        if (!resolvedSourceJobId) {
          throw new BadRequestException("sourceJobId is required for TRIP line items");
        }
        const sourceTripId = String(line.sourceTripId ?? "").trim();
        if (!sourceTripId) {
          throw new BadRequestException("sourceTripId is required for TRIP line items");
        }
        const trip = await this.prisma.trip.findFirst({
          where: {
            id: sourceTripId,
            tenantId,
            jobId: resolvedSourceJobId,
          },
          select: { id: true, status: true },
        });
        if (!trip) {
          throw new BadRequestException("sourceTripId must belong to sourceJobId");
        }
        if (trip.status === TripStatus.CANCELLED) {
          throw new BadRequestException("Cancelled trips cannot be invoiced");
        }
        await validateQuotationSourceItemForInvoice(line, false);
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
        trips: {
          select: {
            id: true,
            status: true,
            tripSequence: true,
            jobSequence: true,
            originLabel: true,
            originAddressLine1: true,
            originAddressLine2: true,
            destinationLabel: true,
            destinationAddressLine1: true,
            destinationAddressLine2: true,
          },
        },
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
    const billableTrips = (job.trips ?? []).filter((t: any) =>
      this.isBillableTripStatus(t.status as TripStatus),
    );
    const billableTripSummaries = billableTrips.map((trip: any) => {
      const tripDisplayRef = buildTripDisplayRef({
        jobInternalRef: job.internalRef,
        tripSequence: trip.tripSequence,
        jobSequence: trip.jobSequence,
        tripId: trip.id,
      });
      const { fromLabel, toLabel } = this.buildTripLineLabels(trip);
      return { tripId: trip.id, tripDisplayRef, fromLabel, toLabel };
    });

    if (existingDraft) {
      const amountDueCents = existingDraft.totalCents;
      return {
        job: {
          id: job.id,
          internalJobReference: job.internalRef,
          customerReference: job.externalRef ?? null,
          jobType: job.jobType,
          billableTripCount: billableTrips.length,
        },
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
          sourceJobId: (existingDraft as any).sourceJobId ?? job.id,
          description: li.description,
          qty: li.qty,
          unitPriceCents: li.unitPriceCents,
          taxCode: li.taxCode,
          taxRate: li.taxRate,
          sourceType: li.sourceType ?? "MANUAL",
          sourceMasterItemId: li.sourceMasterItemId ?? null,
          sourceTripId: li.sourceTripId ?? null,
          tripDisplayRef: li.tripDisplayRefSnapshot ?? null,
          requiresManualAmount: li.requiresManualAmount ?? false,
        })),
        subtotalCents: existingDraft.subtotalCents,
        taxCents: existingDraft.taxCents,
        totalCents: existingDraft.totalCents,
        amountDueCents,
        existingDraftInvoiceId: existingDraft.id,
        billableTrips: billableTripSummaries,
        quotationOptions,
      };
    }

    const templateCode = "WISDOM_FORCE";
    const prefillLineItems: Array<any> = billableTripSummaries.map((trip) => {
      return {
        sourceType: "TRIP",
        sourceJobId: job.id,
        sourceMasterItemId: null,
        sourceTripId: trip.tripId,
        tripDisplayRef: trip.tripDisplayRef,
        fromLabel: trip.fromLabel,
        toLabel: trip.toLabel,
        description: this.buildTripLineDescription(
          trip.tripDisplayRef,
          trip.fromLabel,
          trip.toLabel,
        ),
        qty: 1,
        unitPriceCents: null,
        taxCode: "SR",
        taxRate,
        requiresManualAmount: true,
        isEditable: true,
      };
    });

    if (prefillLineItems.length === 0) {
      throw new BadRequestException("No billable trips found for invoice prefill");
    }

    const totals = this.computeInvoiceTotals(prefillLineItems);

    return {
      job: {
        id: job.id,
        internalJobReference: job.internalRef,
        customerReference: job.externalRef ?? null,
        jobType: job.jobType,
        billableTripCount: billableTrips.length,
      },
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
      billableTrips: billableTripSummaries,
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
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0; // basis points
      return {
        ...l,
        unitPriceCents,
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
              sourceTripId: (l as any).sourceTripId ?? null,
              tripDisplayRefSnapshot: (l as any).tripDisplayRef ?? null,
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

    rt.publishInvoiceEvent(this.realtime, "invoice.created", tenantId, created.id, {
      jobId: dto.sourceJobId ?? null,
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
        sourceJobId: (inv as any).sourceJobId ?? null,
        sourceMasterItemId: l.sourceMasterItemId ?? null,
        sourceTripId: l.sourceTripId ?? null,
        tripDisplayRef: l.tripDisplayRefSnapshot ?? null,
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
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return {
        ...l,
        unitPriceCents,
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
            sourceTripId: (l as any).sourceTripId ?? null,
            tripDisplayRefSnapshot: (l as any).tripDisplayRef ?? null,
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
    const inv = await this.prisma.invoice.findFirst({
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

    // Validate orders before opening the transaction.
    const orders =
      orderIds.length > 0
        ? await this.prisma.transportOrder.findMany({
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
          ![OrderStatus.Delivered, OrderStatus.Closed].includes(o.status as any),
      );
      if (bad) {
        throw new BadRequestException(
          "Orders must be Delivered/Closed and not already invoiced",
        );
      }
    }

    const sourceJobId = dto.sourceJobId ?? (inv as any).sourceJobId ?? null;
    const customerCompanyId =
      dto.customerCompanyId ?? (inv as any).customerCompanyId ?? null;
    const draftLineItems = dto.lineItems ?? [];
    const normalizedSourceJobIds = (sourceJobIds ?? [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
    if (normalizedSourceJobIds.length !== (sourceJobIds ?? []).length) {
      throw new BadRequestException("sourceJobIds cannot contain empty values");
    }
    const uniqueSourceJobIds = Array.from(new Set(normalizedSourceJobIds));
    if (uniqueSourceJobIds.length > 0) {
      const foundJobs = await this.prisma.job.findMany({
        where: {
          tenantId,
          id: { in: uniqueSourceJobIds },
        },
        select: { id: true },
      });
      if (foundJobs.length !== uniqueSourceJobIds.length) {
        throw new BadRequestException("Some sourceJobIds not found under this tenant");
      }
    }

    await this.validateInvoiceLineSources(
      tenantId,
      customerCompanyId,
      sourceJobId,
      draftLineItems,
    );

    // Compute totals from manual line items before opening the transaction.
    const normalized = draftLineItems.map((l) => {
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return {
        ...l,
        unitPriceCents,
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
      sourceJobIds: normalizedSourceJobIds,
      confirmedAt:
        draftMeta.confirmedAt?.toISOString() ?? prevSnap?.confirmedAt ?? null,
      confirmedByUserId:
        draftMeta.confirmedByUserId ?? prevSnap?.confirmedByUserId ?? null,
      updatedAt: new Date().toISOString(),
      updatedByUserId: updatedByUserId ?? null,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          customerName: dto.customerName,
          customerCompanyId,
          sourceJobId,
          templateCode: dto.templateCode ?? (inv as any).templateCode ?? "DB_WISDOM",
          currency: dto.currency ?? inv.currency,
          issueDate,
          dueDate,
          notes: dto.notes ?? null,
          subtotalCents,
          taxCents,
          totalCents,
          snapshot: nextSnapshot,
        },
      });

      await tx.invoiceLineItem.deleteMany({
        where: { tenantId, invoiceId: inv.id },
      });

      if (normalized.length > 0) {
        await tx.invoiceLineItem.createMany({
          data: normalized.map((l) => ({
            tenantId,
            invoiceId: inv.id,
            description: l.description,
            qty: l.qty,
            unitPriceCents: l.unitPriceCents,
            amountCents: l.amountCents,
            taxCode: l.taxCode,
            taxRate: l.taxRate,
            taxCents: l.taxCents,
            sourceType: (l as any).sourceType ?? "MANUAL",
            sourceMasterItemId: (l as any).sourceMasterItemId ?? null,
            sourceTripId: (l as any).sourceTripId ?? null,
            tripDisplayRefSnapshot: (l as any).tripDisplayRef ?? null,
            requiresManualAmount: Boolean((l as any).requiresManualAmount),
          })),
        });
      }

      return tx.invoice.findFirst({
        where: { id: inv.id, tenantId },
        include: { lineItems: true, orders: { select: { id: true } } },
      });
    });
    if (!updated) throw new BadRequestException("Failed to update draft invoice");

    // Draft has no linked orders; return with snapshot orderIds.
    // PDF: regenerated on the client after edits; upload via POST .../pdf.
    const snap = updated.snapshot as any;
    const snapshotOrderIds = Array.isArray(snap?.orderIds) ? snap.orderIds : [];
    rt.publishInvoiceEvent(this.realtime, "invoice.updated", tenantId, invoiceId, {
      jobId: (updated as any).sourceJobId ?? dto.sourceJobId ?? null,
    });
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
    const templateCode = String((inv as any).templateCode ?? "").trim().toUpperCase();
    const resolvedTemplateCode =
      templateCode === "WISDOM_FORCE" ||
      ((inv as any).sourceJobId && (inv as any).customerCompanyId)
        ? "WISDOM_FORCE"
        : "DB_WISDOM";
    return {
      invoiceNo: inv.invoiceNo,
      templateCode: resolvedTemplateCode,
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
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoBytes = loadInvoiceAssetBuffer("WF-logo.jpeg");
    const qrBytes =
      loadInvoiceAssetBuffer("WF-QR.png") ?? loadInvoiceAssetBuffer("WF-QR.jpeg");
    const marginX = 42;
    const pageWidth = 595.28;
    const contentRight = pageWidth - marginX;

    const tryEmbedImage = async (bytes: Buffer) => {
      try {
        return await pdfDoc.embedJpg(bytes);
      } catch {
        try {
          return await pdfDoc.embedPng(bytes);
        } catch {
          return null;
        }
      }
    };

    let y = 804;
    if (logoBytes) {
      const logo = await tryEmbedImage(logoBytes);
      if (logo) {
        const w = 170;
        const h = (logo.height / logo.width) * w;
        page.drawImage(logo, { x: marginX, y: y - h + 8, width: w, height: h });
      } else {
        console.warn("[invoices] Failed to embed WF-logo asset in PDF");
      }
    } else {
      page.drawText("WISDOM FORCE LOGISTICS PTE LTD", { x: marginX, y: y - 10, size: 11, font: bold });
    }

    page.drawText("TAX INVOICE", { x: 382, y: 802, size: 18, font: bold });
    page.drawText(`Invoice No: ${renderData.invoiceNo}`, { x: 382, y: 782, size: 10, font });
    page.drawText(`Invoice Date: ${renderData.issueDateISO}`, { x: 382, y: 768, size: 10, font });
    page.drawText(`Due Date: ${renderData.dueDateISO ?? "-"}`, { x: 382, y: 754, size: 10, font });
    page.drawText(`Reference: ${renderData.reference ?? "-"}`, { x: 382, y: 740, size: 10, font });

    y = 714;
    page.drawText("Bill To", { x: marginX, y, size: 11, font: bold });
    y -= 14;
    page.drawText(String(renderData.customerName ?? ""), { x: marginX, y, size: 10, font: bold });
    y -= 13;
    page.drawText(String(renderData.customerBillingAddress ?? ""), { x: marginX, y, size: 10, font });

    y = 656;
    page.drawText("Description", { x: marginX, y, size: 10, font: bold });
    page.drawText("Qty", { x: 352, y, size: 10, font: bold });
    page.drawText("Unit Price", { x: 390, y, size: 10, font: bold });
    page.drawText("Tax", { x: 470, y, size: 10, font: bold });
    page.drawText("Amount", { x: 520, y, size: 10, font: bold });
    y -= 8;
    page.drawLine({ start: { x: marginX, y }, end: { x: contentRight, y }, thickness: 0.8 });

    const wrapLine = (text: string, maxWidth: number): string[] => {
      const wrapped: string[] = [];
      for (const paragraph of String(text ?? "").split("\n")) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
          wrapped.push("");
          continue;
        }
        let current = "";
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, 9.2) <= maxWidth) {
            current = candidate;
          } else {
            if (current) wrapped.push(current);
            if (font.widthOfTextAtSize(word, 9.2) <= maxWidth) {
              current = word;
            } else {
              let chunk = "";
              for (const ch of word) {
                const next = chunk + ch;
                if (font.widthOfTextAtSize(next, 9.2) <= maxWidth) {
                  chunk = next;
                } else {
                  if (chunk) wrapped.push(chunk);
                  chunk = ch;
                }
              }
              current = chunk;
            }
          }
        }
        if (current) wrapped.push(current);
      }
      return wrapped.length > 0 ? wrapped : [""];
    };

    for (const line of renderData.lines.slice(0, 16)) {
      const wrappedDescription = wrapLine(String(line.description ?? ""), 300);
      const rowHeight = Math.max(14, wrappedDescription.length * 11 + 4);
      y -= rowHeight;
      if (y < 120) break;
      const amount = (Number(line.amountCents || 0) / 100).toFixed(2);
      const unit = (Number(line.unitPriceCents || 0) / 100).toFixed(2);
      wrappedDescription.forEach((descLine, idx) => {
        page.drawText(descLine, { x: marginX, y: y + rowHeight - 12 - idx * 11, size: 9.2, font });
      });
      page.drawText(String(line.qty), { x: 355, y: y + rowHeight - 12, size: 9.5, font });
      page.drawText(unit, { x: 396, y: y + rowHeight - 12, size: 9.5, font });
      page.drawText(String(line.taxLabel ?? ""), { x: 472, y: y + rowHeight - 12, size: 9.5, font });
      page.drawText(amount, { x: 520, y: y + rowHeight - 12, size: 9.5, font });
    }
    y -= 12;
    page.drawLine({ start: { x: 338, y }, end: { x: contentRight, y }, thickness: 0.8 });
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
    page.drawText("Invoice Total", { x: 370, y, size: 10.5, font: bold });
    page.drawText(`SGD ${total}`, { x: 500, y, size: 10.5, font: bold });
    y -= 13;
    page.drawText("Total Net Payments", { x: 370, y, size: 10, font });
    page.drawText("SGD 0.00", { x: 500, y, size: 10, font });
    y -= 14;
    page.drawText("Amount Due", { x: 370, y, size: 11, font: bold });
    page.drawText(`SGD ${due}`, { x: 500, y, size: 11, font: bold });

    const page2 = pdfDoc.addPage([595.28, 841.89]);
    page2.drawText("Payment Details", { x: marginX, y: 790, size: 16, font: bold });
    page2.drawText(String(renderData.paymentInstructions ?? "Bank transfer / PayNow supported."), {
      x: marginX,
      y: 756,
      size: 11,
      font,
    });
    page2.drawText("PayNow / SGQR", { x: marginX, y: 724, size: 12, font: bold });
    page2.drawText("Scan to Pay", { x: marginX, y: 706, size: 11, font });
    page2.drawText(`UEN: ${renderData.sellerUen ?? "202606497W"}`, { x: marginX, y: 690, size: 11, font });
    if (qrBytes) {
      const qr = await tryEmbedImage(qrBytes);
      if (qr) {
        const w = 190;
        const h = (qr.height / qr.width) * w;
        page2.drawImage(qr, { x: 360, y: 735 - h, width: w, height: h });
        page2.drawRectangle({
          x: 356,
          y: 731 - h,
          width: w + 8,
          height: h + 8,
          borderWidth: 1,
        });
      } else {
        console.warn("[invoices] Failed to embed WF-QR asset in PDF");
        page2.drawText("QR unavailable", { x: 365, y: 700, size: 10, font });
      }
    } else {
      page2.drawText("QR unavailable", { x: 365, y: 700, size: 10, font });
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

  private buildInvoicePdfFileName(
    sourceJobInternalRef: string | null | undefined,
    fallbackInvoiceNo: string | null | undefined,
    invoiceId: string,
  ): string {
    const safeRef = this.safeFileName(
      sourceJobInternalRef || fallbackInvoiceNo || invoiceId,
    );
    return `${safeRef}-INVOICE.pdf`;
  }

  private buildInvoicePdfStorageKey(
    tenantId: string,
    invoiceId: string,
    fileName: string,
  ): string {
    return `${tenantId}/invoices/${invoiceId}/${fileName}`;
  }

  private toInvoicePdfUploadError(error: { message?: string } | null | undefined) {
    const message = String(error?.message ?? "");
    if (
      message.toLowerCase().includes("bucket") &&
      message.toLowerCase().includes("not found")
    ) {
      return new BadRequestException(
        "Storage bucket 'invoice-documents' does not exist. Create it in Supabase Storage.",
      );
    }
    return new BadRequestException(`Failed to upload invoice PDF: ${message || "unknown error"}`);
  }

  private async persistInvoicePdfSnapshot(params: {
    tenantId: string;
    invoice: any;
    customerCompanyId: string;
    sourceJobId: string | null;
    sourceJobInternalRef: string | null;
    actorUserId: string | null;
    pdfBuffer: Buffer;
  }): Promise<{ updatedInvoice: any; document: any }> {
    const {
      tenantId,
      invoice,
      customerCompanyId,
      sourceJobId,
      sourceJobInternalRef,
      actorUserId,
      pdfBuffer,
    } = params;
    const fileName = this.buildInvoicePdfFileName(
      sourceJobInternalRef,
      invoice.invoiceNo,
      invoice.id,
    );
    const storageKey = this.buildInvoicePdfStorageKey(tenantId, invoice.id, fileName);
    const supabase = this.supabaseService.getClient();
    const { error: uploadError } = await supabase.storage
      .from(INVOICE_DOCUMENTS_BUCKET)
      .upload(storageKey, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) {
      throw this.toInvoicePdfUploadError(uploadError);
    }

    const generatedAt = new Date();
    const obsoleteStorageKeys = new Set<string>();

    try {
      const { updatedInvoice, document } = await this.prisma.$transaction(async (tx) => {
        const existingDocuments = await tx.customerCompanyDocument.findMany({
          where: {
            tenantId,
            sourceInvoiceId: invoice.id,
            type: { in: ["INVOICE", "COMPANY_INVOICE"] },
          },
          orderBy: [{ createdAt: "desc" }],
          select: { id: true, storageKey: true, status: true },
        });

        existingDocuments.forEach((row: any) => {
          if (row.storageKey && row.storageKey !== storageKey) {
            obsoleteStorageKeys.add(row.storageKey);
          }
        });
        if (invoice.pdfKey && invoice.pdfKey !== storageKey) {
          obsoleteStorageKeys.add(invoice.pdfKey);
        }

        const primaryDocument = existingDocuments[0] ?? null;
        const document = primaryDocument
          ? await tx.customerCompanyDocument.update({
              where: { id: primaryDocument.id },
              data: {
                customerCompanyId,
                type: "INVOICE",
                fileName,
                fileUrl: storageKey,
                storageKey,
                mimeType: "application/pdf",
                fileSizeBytes: pdfBuffer.length,
                uploadedByUserId: actorUserId ?? null,
                generatedByUserId: actorUserId ?? null,
                generatedAt,
                sourceJobId,
                sourceInvoiceId: invoice.id,
                status: "ACTIVE",
                deletedAt: null,
              },
              include: { generatedBy: { select: { name: true, email: true } } },
            })
          : await tx.customerCompanyDocument.create({
              data: {
                tenantId,
                customerCompanyId,
                type: "INVOICE",
                fileName,
                fileUrl: storageKey,
                storageKey,
                mimeType: "application/pdf",
                fileSizeBytes: pdfBuffer.length,
                uploadedByUserId: actorUserId ?? null,
                generatedByUserId: actorUserId ?? null,
                generatedAt,
                sourceJobId,
                sourceInvoiceId: invoice.id,
                status: "ACTIVE",
              },
              include: { generatedBy: { select: { name: true, email: true } } },
            });

        const supersededDocumentIds = existingDocuments
          .map((row: any) => row.id)
          .filter((id: string) => id !== document.id);
        if (supersededDocumentIds.length > 0) {
          await tx.customerCompanyDocument.updateMany({
            where: { id: { in: supersededDocumentIds } },
            data: {
              status: "DELETED",
              deletedAt: generatedAt,
            },
          });
        }

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            pdfKey: storageKey,
            pdfGeneratedAt: generatedAt,
          },
          include: {
            lineItems: true,
            orders: { select: { id: true, customerCompanyId: true } },
          },
        });

        return { updatedInvoice, document };
      });

      const keysToDelete = Array.from(obsoleteStorageKeys);
      if (keysToDelete.length > 0) {
        await supabase.storage.from(INVOICE_DOCUMENTS_BUCKET).remove(keysToDelete);
      }

      return { updatedInvoice, document };
    } catch (error) {
      await supabase.storage.from(INVOICE_DOCUMENTS_BUCKET).remove([storageKey]);
      throw error;
    }
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
    if (!renderData.customerCompanyId) {
      throw new BadRequestException(
        "Invoice must have a customerCompanyId before generating a PDF",
      );
    }
    const pdfBuffer = await this.createInvoicePdfBuffer(renderData);
    const { updatedInvoice, document } = await this.persistInvoicePdfSnapshot({
      tenantId,
      invoice: inv,
      customerCompanyId: renderData.customerCompanyId,
      sourceJobId: renderData.sourceJobId,
      sourceJobInternalRef: renderData.sourceJobInternalRef,
      actorUserId,
      pdfBuffer,
    });

    rt.publishInvoiceEvent(this.realtime, "invoice.generated", tenantId, inv.id, {
      jobId: renderData.sourceJobId ?? null,
    });

    return {
      invoiceId: inv.id,
      status: updatedInvoice.status,
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
    const actorUserId: string | null = user?.userId ?? null;

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

    if (!inv.customerCompanyId) {
      throw new BadRequestException(
        "Invoice must have a customerCompanyId before uploading a PDF",
      );
    }

    const sourceJob = inv.sourceJobId
      ? await this.prisma.job.findFirst({
          where: { tenantId, id: inv.sourceJobId },
          select: { internalRef: true },
        })
      : null;
    const sourceJobInternalRef = sourceJob?.internalRef ?? null;
    const { updatedInvoice } = await this.persistInvoicePdfSnapshot({
      tenantId,
      invoice: inv,
      customerCompanyId: inv.customerCompanyId,
      sourceJobId: inv.sourceJobId ?? null,
      sourceJobInternalRef,
      actorUserId,
      pdfBuffer: file.buffer,
    });

    rt.publishInvoiceEvent(this.realtime, "invoice.generated", tenantId, invoiceId, {
      jobId: inv.sourceJobId ?? null,
    });

    return this.toDtoWithNames(updatedInvoice);
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
        .from(INVOICE_DOCUMENTS_BUCKET)
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
      .from(INVOICE_DOCUMENTS_BUCKET)
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
      .storage.from(INVOICE_DOCUMENTS_BUCKET)
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
