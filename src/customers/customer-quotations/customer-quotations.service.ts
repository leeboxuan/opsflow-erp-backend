import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CustomerQuotationAcceptanceMethod,
  CustomerQuotationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { AuditService } from "../../shared/audit/audit.service";
import { SupabaseService } from "../../shared/auth/supabase.service";
import { createCustomerQuotationPdfBuffer } from "./customer-quotation-pdf";
import {
  DEFAULT_TAX_RATE_BP,
  lineAmountCents,
  lineTaxCents,
} from "./customer-quotation-money";
import {
  AcceptCustomerQuotationDto,
  CreateBlankCustomerQuotationDto,
  CreateCustomerQuotationFromTemplateDto,
  CustomerQuotationLineInputDto,
  UpdateCustomerQuotationDto,
} from "./customer-quotations.dto";

const QUOTATION_PDF_BUCKET = "job-documents";
const PDF_SIGNED_URL_TTL_SECONDS = 60 * 60;

type LineTotals = {
  normalized: Array<{
    sortOrder: number;
    code: string;
    label: string;
    description: string | null;
    unit: string | null;
    qty: number;
    unitPriceCents: number;
    amountCents: number;
    currency: string;
    taxCode: string;
    taxRate: number;
    taxCents: number;
    requiresManualAmount: boolean;
    sourceTemplateRowId: string | null;
    sourceMasterRowId: string | null;
    metadataJson?: Prisma.InputJsonValue;
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

@Injectable()
export class CustomerQuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private async assertCustomerCompany(
    tenantId: string,
    customerCompanyId: string,
  ) {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: customerCompanyId, tenantId },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");
    return company;
  }

  /** Cross-customer IDs resolve as NotFound (no existence leak). */
  private assertSameCustomer(
    rowCustomerCompanyId: string,
    routeCustomerId: string,
  ) {
    if (rowCustomerCompanyId !== routeCustomerId) {
      throw new NotFoundException("Customer quotation not found");
    }
  }

  private parseOptionalDate(value?: string | null): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date: ${value}`);
    }
    return d;
  }

  /** UTC end-of-day for the calendar day of `d`. */
  endOfUtcDay(d: Date): Date {
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
  }

  isIssuedPastValidUntil(status: CustomerQuotationStatus, validUntil: Date | null, now = new Date()) {
    if (status !== CustomerQuotationStatus.ISSUED) return false;
    if (!validUntil) return false;
    return now.getTime() > this.endOfUtcDay(validUntil).getTime();
  }

  /**
   * Authoritative expiry: ISSUED + validUntil past UTC EOD → EXPIRED.
   * Terminal ACCEPTED/REJECTED/VOID never auto-expire. DRAFT stays DRAFT.
   */
  async materializeExpiry<T extends {
    id: string;
    tenantId: string;
    status: CustomerQuotationStatus;
    validUntil: Date | null;
  }>(quotation: T, now = new Date()): Promise<T> {
    if (
      !this.isIssuedPastValidUntil(quotation.status, quotation.validUntil, now)
    ) {
      return quotation;
    }
    // Conditional: never overwrite ACCEPTED/REJECTED/VOID.
    const result = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId: quotation.tenantId,
        status: CustomerQuotationStatus.ISSUED,
      },
      data: {
        status: CustomerQuotationStatus.EXPIRED,
        expiredAt: now,
      },
    });
    if (result.count === 0) {
      const fresh = await this.prisma.customerQuotation.findFirst({
        where: { id: quotation.id, tenantId: quotation.tenantId },
        include: {
          lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      });
      return (fresh ?? quotation) as unknown as T;
    }
    await this.audit.log(
      quotation.tenantId,
      "STATUS_CHANGE",
      "CustomerQuotation",
      quotation.id,
      { from: CustomerQuotationStatus.ISSUED, to: CustomerQuotationStatus.EXPIRED },
      null,
    );
    const updated = await this.prisma.customerQuotation.findFirst({
      where: { id: quotation.id, tenantId: quotation.tenantId },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });
    return (updated ?? { ...quotation, status: CustomerQuotationStatus.EXPIRED }) as unknown as T;
  }

  async materializeExpiredForCustomer(tenantId: string, customerId: string, now = new Date()) {
    const candidates = await this.prisma.customerQuotation.findMany({
      where: {
        tenantId,
        customerCompanyId: customerId,
        status: CustomerQuotationStatus.ISSUED,
        validUntil: { not: null },
      },
      select: { id: true, validUntil: true },
    });
    const expiredIds = candidates
      .filter((q) => q.validUntil && now.getTime() > this.endOfUtcDay(q.validUntil).getTime())
      .map((q) => q.id);
    if (expiredIds.length === 0) return;
    await this.prisma.customerQuotation.updateMany({
      where: { tenantId, id: { in: expiredIds }, status: CustomerQuotationStatus.ISSUED },
      data: { status: CustomerQuotationStatus.EXPIRED, expiredAt: now },
    });
  }

  async allocateQuotationNo(
    tenantId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
    at = new Date(),
  ): Promise<string> {
    const yyyy = at.getUTCFullYear();
    const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
    const yyyymm = `${yyyy}${mm}`;

    const row = await (client as any).quotation_no_counters.upsert({
      where: { tenantId_yyyymm: { tenantId, yyyymm } },
      create: { tenantId, yyyymm, nextSeq: 1 },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });
    return `QT-${yyyymm}-${String(row.nextSeq).padStart(4, "0")}`;
  }

  computeLineTotals(
    lines: CustomerQuotationLineInputDto[],
    quotationCurrency = "SGD",
  ): LineTotals {
    const currency = quotationCurrency.trim() || "SGD";
    const normalized = (lines ?? []).map((l, index) => {
      const code = String(l.code ?? "").trim();
      const label = String(l.label ?? "").trim();
      if (!code || !label) {
        throw new BadRequestException("Each line requires non-empty code and label");
      }
      const qty = l.qty === undefined || l.qty === null ? 1 : Number(l.qty);
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      let amountCents: number;
      try {
        amountCents = lineAmountCents(qty, unitPriceCents);
      } catch {
        throw new BadRequestException(
          `Invalid qty/unitPriceCents for line ${code} (qty max 3 decimals; unitPriceCents integer cents)`,
        );
      }
      const taxRate =
        l.taxRate === undefined || l.taxRate === null
          ? DEFAULT_TAX_RATE_BP
          : Number(l.taxRate);
      let taxCents: number;
      try {
        taxCents = lineTaxCents(amountCents, taxRate);
      } catch {
        throw new BadRequestException(`Invalid taxRate for line ${code}`);
      }
      // Client-supplied amount/tax/totals are ignored; server recalculates.
      // Line currency always matches quotation header currency.
      return {
        sortOrder: l.sortOrder ?? index,
        code,
        label,
        description: l.description ?? null,
        unit: l.unit ?? null,
        qty,
        unitPriceCents,
        amountCents,
        currency,
        taxCode: l.taxCode?.trim() || (taxRate > 0 ? "SR" : "ZR"),
        taxRate,
        taxCents,
        requiresManualAmount: !!l.requiresManualAmount,
        sourceTemplateRowId: l.sourceTemplateRowId ?? null,
        sourceMasterRowId: l.sourceMasterRowId ?? null,
        metadataJson:
          l.metadataJson === undefined
            ? undefined
            : (l.metadataJson as Prisma.InputJsonValue),
      };
    });
    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    return {
      normalized,
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
    };
  }

  private isPopulated(quotation: {
    sourceTemplateId: string | null;
    lines?: unknown[];
    _count?: { lines?: number };
  }) {
    const lineCount =
      quotation._count?.lines ??
      (Array.isArray(quotation.lines) ? quotation.lines.length : 0);
    return Boolean(quotation.sourceTemplateId) || lineCount > 0;
  }

  async list(tenantId: string, customerId: string) {
    await this.assertCustomerCompany(tenantId, customerId);
    await this.materializeExpiredForCustomer(tenantId, customerId);
    return this.prisma.customerQuotation.findMany({
      where: { tenantId, customerCompanyId: customerId },
      orderBy: [{ updatedAt: "desc" }],
      include: { _count: { select: { lines: true } } },
    });
  }

  async getById(tenantId: string, customerId: string, id: string) {
    await this.assertCustomerCompany(tenantId, customerId);
    const quotation = await this.prisma.customerQuotation.findFirst({
      where: { tenantId, id },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });
    if (!quotation) throw new NotFoundException("Customer quotation not found");
    this.assertSameCustomer(quotation.customerCompanyId, customerId);
    return this.materializeExpiry(quotation);
  }

  async createBlank(
    tenantId: string,
    customerId: string,
    dto: CreateBlankCustomerQuotationDto,
    actorUserId: string | null,
  ) {
    const company = await this.assertCustomerCompany(tenantId, customerId);

    const created = await this.prisma.$transaction(async (tx) => {
      const quotationNo = await this.allocateQuotationNo(tenantId, tx);
      return tx.customerQuotation.create({
        data: {
          tenantId,
          customerCompanyId: customerId,
          quotationNo,
          title: dto.title?.trim() || null,
          status: CustomerQuotationStatus.DRAFT,
          currency: dto.currency?.trim() || "SGD",
          notes: dto.notes ?? null,
          validFrom: this.parseOptionalDate(dto.validFrom) ?? null,
          validUntil: this.parseOptionalDate(dto.validUntil) ?? null,
          customerNameSnapshot: company.name,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
        include: { lines: true },
      });
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "CustomerQuotation",
      created.id,
      { quotationNo: created.quotationNo, customerCompanyId: customerId },
      actorUserId,
    );
    return created;
  }

  async createFromTemplate(
    tenantId: string,
    customerId: string,
    dto: CreateCustomerQuotationFromTemplateDto,
    actorUserId: string | null,
  ) {
    const company = await this.assertCustomerCompany(tenantId, customerId);
    const template = await this.prisma.customerRateTemplate.findFirst({
      where: { tenantId, id: dto.templateId },
      include: {
        rows: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!template) throw new NotFoundException("Rate template not found");
    if (template.customerCompanyId !== customerId) {
      throw new NotFoundException("Rate template not found");
    }
    if (template.status === "ARCHIVED") {
      throw new BadRequestException("Cannot create quotation from an ARCHIVED template");
    }

    const lineInputs: CustomerQuotationLineInputDto[] = template.rows.map(
      (r, index) => ({
        sortOrder: r.sortOrder ?? index,
        code: r.code,
        label: r.label,
        description: r.description,
        unit: r.unit,
        qty: 1,
        unitPriceCents: r.rateCents ?? 0,
        currency: r.currency || template.currency || "SGD",
        taxCode: "SR",
        taxRate: 900,
        requiresManualAmount: r.requiresManualAmount,
        sourceTemplateRowId: r.id,
        sourceMasterRowId: r.sourceMasterRowId,
        metadataJson: r.metadataJson ?? undefined,
      }),
    );
    const totals = this.computeLineTotals(
      lineInputs,
      template.currency || "SGD",
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const quotationNo = await this.allocateQuotationNo(tenantId, tx);
      const quotation = await tx.customerQuotation.create({
        data: {
          tenantId,
          customerCompanyId: customerId,
          quotationNo,
          title: dto.title?.trim() || template.name,
          status: CustomerQuotationStatus.DRAFT,
          currency: template.currency || "SGD",
          notes: dto.notes ?? template.notes ?? null,
          validFrom: this.parseOptionalDate(dto.validFrom) ?? null,
          validUntil: this.parseOptionalDate(dto.validUntil) ?? null,
          sourceTemplateId: template.id,
          sourceTemplateNameSnapshot: template.name,
          customerNameSnapshot: company.name,
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          lines: {
            create: totals.normalized.map((l) => ({
              tenantId,
              sortOrder: l.sortOrder,
              code: l.code,
              label: l.label,
              description: l.description,
              unit: l.unit,
              qty: l.qty,
              unitPriceCents: l.unitPriceCents,
              amountCents: l.amountCents,
              currency: l.currency,
              taxCode: l.taxCode,
              taxRate: l.taxRate,
              taxCents: l.taxCents,
              requiresManualAmount: l.requiresManualAmount,
              sourceTemplateRowId: l.sourceTemplateRowId,
              sourceMasterRowId: l.sourceMasterRowId,
              metadataJson: l.metadataJson,
            })),
          },
        },
        include: {
          lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      });
      return quotation;
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "CustomerQuotation",
      created.id,
      {
        quotationNo: created.quotationNo,
        sourceTemplateId: template.id,
        lineCount: totals.normalized.length,
      },
      actorUserId,
    );
    return created;
  }

  async update(
    tenantId: string,
    customerId: string,
    id: string,
    dto: UpdateCustomerQuotationDto,
    actorUserId: string | null,
  ) {
    let quotation = await this.getById(tenantId, customerId, id);
    if (quotation.status !== CustomerQuotationStatus.DRAFT) {
      throw new BadRequestException("Only DRAFT quotations can be edited");
    }

    const nextCustomerId = dto.customerCompanyId?.trim();
    const customerChanging =
      !!nextCustomerId && nextCustomerId !== quotation.customerCompanyId;

    if (customerChanging) {
      await this.assertCustomerCompany(tenantId, nextCustomerId!);
      const populated = this.isPopulated(quotation);
      if (populated && dto.confirmCustomerChange !== true) {
        throw new BadRequestException(
          "confirmCustomerChange must be true to change customer on a populated quotation; this clears template association and all lines",
        );
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        if (populated) {
          await tx.customerQuotationLine.deleteMany({
            where: { tenantId, quotationId: quotation.id },
          });
        }
        const company = await tx.customer_companies.findFirst({
          where: { id: nextCustomerId!, tenantId },
          select: { name: true },
        });
        return tx.customerQuotation.update({
          where: { id: quotation.id },
          data: {
            customerCompanyId: nextCustomerId!,
            customerNameSnapshot: company?.name ?? quotation.customerNameSnapshot,
            sourceTemplateId: populated ? null : quotation.sourceTemplateId,
            sourceTemplateNameSnapshot: populated
              ? null
              : quotation.sourceTemplateNameSnapshot,
            subtotalCents: populated ? 0 : quotation.subtotalCents,
            taxCents: populated ? 0 : quotation.taxCents,
            totalCents: populated ? 0 : quotation.totalCents,
            title: dto.title !== undefined ? dto.title : quotation.title,
            currency: dto.currency?.trim() || quotation.currency,
            notes: dto.notes !== undefined ? dto.notes : quotation.notes,
            validFrom:
              dto.validFrom !== undefined
                ? this.parseOptionalDate(dto.validFrom) ?? null
                : quotation.validFrom,
            validUntil:
              dto.validUntil !== undefined
                ? this.parseOptionalDate(dto.validUntil) ?? null
                : quotation.validUntil,
            updatedByUserId: actorUserId,
          },
          include: {
            lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
          },
        });
      });

      await this.audit.log(
        tenantId,
        "UPDATE",
        "CustomerQuotation",
        updated.id,
        {
          customerChanged: true,
          fromCustomerId: customerId,
          toCustomerId: nextCustomerId,
          clearedTemplateAndLines: populated,
        },
        actorUserId,
      );
      // Route param customerId no longer matches; return updated for caller awareness.
      return updated;
    }

    const updated = await this.prisma.customerQuotation.update({
      where: { id: quotation.id },
      data: {
        title: dto.title !== undefined ? dto.title : quotation.title,
        currency: dto.currency?.trim() || quotation.currency,
        notes: dto.notes !== undefined ? dto.notes : quotation.notes,
        validFrom:
          dto.validFrom !== undefined
            ? this.parseOptionalDate(dto.validFrom) ?? null
            : quotation.validFrom,
        validUntil:
          dto.validUntil !== undefined
            ? this.parseOptionalDate(dto.validUntil) ?? null
            : quotation.validUntil,
        updatedByUserId: actorUserId,
      },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });

    await this.audit.log(
      tenantId,
      "UPDATE",
      "CustomerQuotation",
      updated.id,
      { fields: Object.keys(dto) },
      actorUserId,
    );
    return updated;
  }

  async replaceLines(
    tenantId: string,
    customerId: string,
    id: string,
    lines: CustomerQuotationLineInputDto[],
    actorUserId: string | null,
  ) {
    const quotation = await this.getById(tenantId, customerId, id);
    if (quotation.status !== CustomerQuotationStatus.DRAFT) {
      throw new BadRequestException("Only DRAFT quotations can replace lines");
    }
    const totals = this.computeLineTotals(lines, quotation.currency);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customerQuotationLine.deleteMany({
        where: { tenantId, quotationId: quotation.id },
      });
      if (totals.normalized.length > 0) {
        await tx.customerQuotationLine.createMany({
          data: totals.normalized.map((l) => ({
            tenantId,
            quotationId: quotation.id,
            sortOrder: l.sortOrder,
            code: l.code,
            label: l.label,
            description: l.description,
            unit: l.unit,
            qty: l.qty,
            unitPriceCents: l.unitPriceCents,
            amountCents: l.amountCents,
            currency: l.currency,
            taxCode: l.taxCode,
            taxRate: l.taxRate,
            taxCents: l.taxCents,
            requiresManualAmount: l.requiresManualAmount,
            sourceTemplateRowId: l.sourceTemplateRowId,
            sourceMasterRowId: l.sourceMasterRowId,
            metadataJson: l.metadataJson,
          })),
        });
      }
      return tx.customerQuotation.update({
        where: { id: quotation.id },
        data: {
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          updatedByUserId: actorUserId,
        },
        include: {
          lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      });
    });

    await this.audit.log(
      tenantId,
      "UPDATE",
      "CustomerQuotation",
      quotation.id,
      { action: "REPLACE_LINES", lineCount: totals.normalized.length, totals },
      actorUserId,
    );
    return updated;
  }

  private toIsoDateOnly(d: Date | null | undefined): string {
    if (!d) return "";
    return d.toISOString().slice(0, 10);
  }

  private buildPdfStorageKey(
    tenantId: string,
    customerId: string,
    quotationId: string,
    quotationNo: string,
  ) {
    const safeNo = quotationNo.replace(/[\\/:*?"<>|]+/g, "-");
    return `${tenantId}/companies/${customerId}/customer-quotations/${quotationId}/${safeNo}.pdf`;
  }

  private async rollbackIssueToDraft(
    quotationId: string,
    tenantId: string,
    actorUserId: string | null,
  ) {
    // Only roll back if still ISSUED — never clobber ACCEPTED/REJECTED/VOID.
    await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotationId,
        tenantId,
        status: CustomerQuotationStatus.ISSUED,
      },
      data: {
        status: CustomerQuotationStatus.DRAFT,
        issueDate: null,
        issuedAt: null,
        issuedByUserId: null,
        lockedAt: null,
        pdfKey: null,
        pdfGeneratedAt: null,
        updatedByUserId: actorUserId,
      },
    });
  }

  async issue(
    tenantId: string,
    customerId: string,
    id: string,
    actorUserId: string | null,
  ) {
    const quotation = await this.getById(tenantId, customerId, id);
    if (quotation.status !== CustomerQuotationStatus.DRAFT) {
      throw new BadRequestException("Only DRAFT quotations can be issued");
    }
    if (!quotation.lines?.length) {
      throw new BadRequestException(
        "Cannot issue a quotation with no commercial lines",
      );
    }

    const now = new Date();
    const issueDate = now;
    const lockResult = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId,
        customerCompanyId: customerId,
        status: CustomerQuotationStatus.DRAFT,
      },
      data: {
        status: CustomerQuotationStatus.ISSUED,
        issueDate,
        issuedAt: now,
        issuedByUserId: actorUserId,
        lockedAt: now,
        updatedByUserId: actorUserId,
      },
    });
    if (lockResult.count === 0) {
      throw new BadRequestException(
        "Quotation could not be issued (already issued or no longer DRAFT)",
      );
    }

    const locked = await this.prisma.customerQuotation.findFirst({
      where: { id: quotation.id, tenantId },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });
    if (!locked || locked.status !== CustomerQuotationStatus.ISSUED) {
      throw new BadRequestException("Quotation could not be issued");
    }

    const dominantTaxRate =
      locked.lines.find((l) => l.taxRate > 0)?.taxRate ?? DEFAULT_TAX_RATE_BP;
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await createCustomerQuotationPdfBuffer({
        quotationNo: locked.quotationNo,
        title: locked.title,
        customerName: locked.customerNameSnapshot || "Customer",
        currency: locked.currency,
        issueDateISO: this.toIsoDateOnly(locked.issueDate),
        validUntilISO: locked.validUntil
          ? this.toIsoDateOnly(locked.validUntil)
          : null,
        notes: locked.notes,
        subtotalCents: locked.subtotalCents,
        taxCents: locked.taxCents,
        totalCents: locked.totalCents,
        taxRatePercent: dominantTaxRate / 100,
        lines: locked.lines.map((l) => ({
          code: l.code,
          label: l.label,
          description: l.description,
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
          amountCents: l.amountCents,
          taxCents: l.taxCents,
        })),
      });
    } catch {
      await this.rollbackIssueToDraft(locked.id, tenantId, actorUserId);
      throw new BadRequestException("Failed to generate quotation PDF");
    }

    const storageKey = this.buildPdfStorageKey(
      tenantId,
      customerId,
      locked.id,
      locked.quotationNo,
    );
    const supabase = this.supabaseService.getClient();
    const { error: uploadError } = await supabase.storage
      .from(QUOTATION_PDF_BUCKET)
      .upload(storageKey, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) {
      await this.rollbackIssueToDraft(locked.id, tenantId, actorUserId);
      throw new BadRequestException("Failed to upload quotation PDF");
    }

    const withPdf = await this.prisma.customerQuotation.update({
      where: { id: locked.id },
      data: {
        pdfKey: storageKey,
        pdfGeneratedAt: new Date(),
      },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });

    await this.audit.log(
      tenantId,
      "STATUS_CHANGE",
      "CustomerQuotation",
      withPdf.id,
      {
        from: CustomerQuotationStatus.DRAFT,
        to: CustomerQuotationStatus.ISSUED,
        pdfKey: storageKey,
      },
      actorUserId,
    );
    return withPdf;
  }

  async accept(
    tenantId: string,
    customerId: string,
    id: string,
    dto: AcceptCustomerQuotationDto,
    actorUserId: string | null,
  ) {
    const quotation = await this.getById(tenantId, customerId, id);
    if (quotation.status === CustomerQuotationStatus.EXPIRED) {
      throw new BadRequestException("Expired quotations cannot be accepted");
    }
    if (quotation.status !== CustomerQuotationStatus.ISSUED) {
      throw new BadRequestException("Only ISSUED quotations can be accepted");
    }
    if (!dto.acceptanceMethod) {
      throw new BadRequestException("acceptanceMethod is required");
    }
    const evidence = String(dto.acceptanceEvidenceNote ?? "").trim();
    if (!evidence) {
      throw new BadRequestException(
        "acceptanceEvidenceNote is required (acceptedByUserId is recorder only)",
      );
    }

    const now = new Date();
    const result = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId,
        customerCompanyId: customerId,
        status: CustomerQuotationStatus.ISSUED,
      },
      data: {
        status: CustomerQuotationStatus.ACCEPTED,
        acceptedAt: now,
        acceptedByUserId: actorUserId,
        acceptanceMethod: dto.acceptanceMethod as CustomerQuotationAcceptanceMethod,
        acceptanceEvidenceNote: evidence,
        acceptanceEvidenceStorageKey: dto.acceptanceEvidenceStorageKey ?? null,
        updatedByUserId: actorUserId,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        "Quotation could not be accepted (no longer ISSUED)",
      );
    }

    const updated = await this.prisma.customerQuotation.findFirst({
      where: { id: quotation.id, tenantId },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });

    await this.audit.log(
      tenantId,
      "STATUS_CHANGE",
      "CustomerQuotation",
      quotation.id,
      {
        from: CustomerQuotationStatus.ISSUED,
        to: CustomerQuotationStatus.ACCEPTED,
        acceptanceMethod: dto.acceptanceMethod,
        note: "acceptedByUserId is staff recorder only; method+evidence prove acceptance",
      },
      actorUserId,
    );
    return updated!;
  }

  async reject(
    tenantId: string,
    customerId: string,
    id: string,
    actorUserId: string | null,
  ) {
    const quotation = await this.getById(tenantId, customerId, id);
    if (quotation.status === CustomerQuotationStatus.EXPIRED) {
      throw new BadRequestException("Expired quotations cannot be rejected");
    }
    if (quotation.status !== CustomerQuotationStatus.ISSUED) {
      throw new BadRequestException("Only ISSUED quotations can be rejected");
    }
    const now = new Date();
    const result = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId,
        customerCompanyId: customerId,
        status: CustomerQuotationStatus.ISSUED,
      },
      data: {
        status: CustomerQuotationStatus.REJECTED,
        rejectedAt: now,
        updatedByUserId: actorUserId,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        "Quotation could not be rejected (no longer ISSUED)",
      );
    }
    const updated = await this.prisma.customerQuotation.findFirst({
      where: { id: quotation.id, tenantId },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });
    await this.audit.log(
      tenantId,
      "STATUS_CHANGE",
      "CustomerQuotation",
      quotation.id,
      { from: CustomerQuotationStatus.ISSUED, to: CustomerQuotationStatus.REJECTED },
      actorUserId,
    );
    return updated!;
  }

  async void(
    tenantId: string,
    customerId: string,
    id: string,
    actorUserId: string | null,
  ) {
    const quotation = await this.getById(tenantId, customerId, id);
    if (
      quotation.status !== CustomerQuotationStatus.DRAFT &&
      quotation.status !== CustomerQuotationStatus.ISSUED
    ) {
      throw new BadRequestException("Only DRAFT or ISSUED quotations can be voided");
    }
    const from = quotation.status;
    const now = new Date();
    const result = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId,
        customerCompanyId: customerId,
        status: { in: [CustomerQuotationStatus.DRAFT, CustomerQuotationStatus.ISSUED] },
      },
      data: {
        status: CustomerQuotationStatus.VOID,
        voidedAt: now,
        lockedAt: quotation.lockedAt ?? now,
        updatedByUserId: actorUserId,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        "Quotation could not be voided (status changed)",
      );
    }
    const updated = await this.prisma.customerQuotation.findFirst({
      where: { id: quotation.id, tenantId },
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });
    await this.audit.log(
      tenantId,
      "STATUS_CHANGE",
      "CustomerQuotation",
      quotation.id,
      { from, to: CustomerQuotationStatus.VOID },
      actorUserId,
    );
    return updated!;
  }

  async getPdfSignedUrl(tenantId: string, customerId: string, id: string) {
    const quotation = await this.getById(tenantId, customerId, id);
    if (!quotation.pdfKey) {
      throw new NotFoundException("Quotation PDF not generated yet");
    }
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(QUOTATION_PDF_BUCKET)
      .createSignedUrl(quotation.pdfKey, PDF_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new BadRequestException("Failed to create signed PDF URL");
    }
    return {
      quotationId: quotation.id,
      quotationNo: quotation.quotationNo,
      pdfKey: quotation.pdfKey,
      pdfGeneratedAt: quotation.pdfGeneratedAt,
      url: data.signedUrl,
      expiresInSeconds: PDF_SIGNED_URL_TTL_SECONDS,
    };
  }
}
