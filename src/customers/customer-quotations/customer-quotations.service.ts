import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CustomerQuotationAcceptanceMethod,
  CustomerQuotationStatus,
  MasterRateDatasetStatus,
  MasterRateDatasetType,
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
  CreateCustomerQuotationFromMasterDto,
  CreateCustomerQuotationFromRateExcelDto,
  CreateCustomerQuotationFromTemplateDto,
  CustomerQuotationLineInputDto,
  UpdateCustomerQuotationDto,
} from "./customer-quotations.dto";
import {
  buildQuotationReconciliation,
  parseQuotationMatrixFromXlsxBuffer,
  parseQuotationRateLinesFromXlsxBuffer,
  type ParsedQuotationRateLineInput,
  type QuotationReconciliationSummary,
} from "../quotation-parse.helpers";

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
  /** Single-flight guard: one in-progress Excel→quotation create per tenant+customer. */
  private readonly rateExcelCreateInFlight = new Set<string>();

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

  /**
   * Create DRAFT quotation by deep-copying the ACTIVE master QUOTATION base template.
   * Does not invoke the Excel parser; lines are snapshotted independently of master.
   */
  async createFromMaster(
    tenantId: string,
    customerId: string,
    dto: CreateCustomerQuotationFromMasterDto,
    actorUserId: string | null,
  ) {
    const company = await this.assertCustomerCompany(tenantId, customerId);
    const dataset =
      (await this.prisma.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.QUOTATION,
          isCurrent: true,
        },
        include: {
          rows: {
            orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
          },
        },
      })) ??
      (await this.prisma.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.QUOTATION,
          status: MasterRateDatasetStatus.ACTIVE,
        },
        orderBy: { versionNo: "desc" },
        include: {
          rows: {
            orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
          },
        },
      }));
    if (!dataset) {
      throw new BadRequestException(
        "No base quotation template is configured. Import Excel or create a blank template first.",
      );
    }

    const currency = dto.currency?.trim() || "SGD";
    const sourceTemplateNameSnapshot = `Master quotation template v${dataset.versionNo}`;
    const lineInputs: CustomerQuotationLineInputDto[] = dataset.rows.map(
      (r, index) => {
        const baseMeta =
          r.metadataJson && typeof r.metadataJson === "object"
            ? { ...(r.metadataJson as Record<string, unknown>) }
            : {};
        // Line has no notes column — carry via description/metadata.
        if (r.notes != null && String(r.notes).trim() !== "") {
          baseMeta.notes = r.notes;
        }
        if (r.rawRateText != null && baseMeta.rawRateText == null) {
          baseMeta.rawRateText = r.rawRateText;
        }
        const description =
          r.description ??
          (r.notes != null && String(r.notes).trim() !== ""
            ? String(r.notes)
            : null);
        return {
          sortOrder: r.sortOrder ?? index,
          code: r.code,
          label: r.label,
          description,
          unit: r.unit,
          qty: 1,
          unitPriceCents: r.rateCents ?? 0,
          currency: r.currency || currency,
          taxCode: "SR",
          taxRate: DEFAULT_TAX_RATE_BP,
          requiresManualAmount: r.requiresManualAmount,
          sourceTemplateRowId: null,
          sourceMasterRowId: r.id,
          metadataJson:
            Object.keys(baseMeta).length > 0
              ? (baseMeta as Prisma.InputJsonValue)
              : undefined,
        };
      },
    );
    const totals = this.computeLineTotals(lineInputs, currency);

    const created = await this.prisma.$transaction(async (tx) => {
      const quotationNo = await this.allocateQuotationNo(tenantId, tx);
      const quotation = await tx.customerQuotation.create({
        data: {
          tenantId,
          customerCompanyId: customerId,
          quotationNo,
          title: dto.title?.trim() || sourceTemplateNameSnapshot,
          status: CustomerQuotationStatus.DRAFT,
          currency,
          notes: dto.notes ?? null,
          validFrom: this.parseOptionalDate(dto.validFrom) ?? null,
          validUntil: this.parseOptionalDate(dto.validUntil) ?? null,
          sourceTemplateId: null,
          sourceTemplateNameSnapshot,
          customerNameSnapshot: company.name,
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
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
            // Deep-copied values — independent of live master rows.
            metadataJson: l.metadataJson,
          })),
        });
      }

      return tx.customerQuotation.findFirst({
        where: { tenantId, id: quotation.id },
        include: {
          lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      });
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "CustomerQuotation",
      created!.id,
      {
        quotationNo: created!.quotationNo,
        fromMasterDatasetId: dataset.id,
        versionNo: dataset.versionNo,
        lineCount: totals.normalized.length,
      },
      actorUserId,
    );
    return created!;
  }

  private assertExcelQuotationFile(file: Express.Multer.File) {
    const name = String(file?.originalname ?? "").toLowerCase();
    const isExcel = /\.xlsx?$/i.test(name);
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    if (!isExcel) {
      throw new BadRequestException("Quotation import must be Excel (.xlsx/.xls)");
    }
  }

  private parseRateExcelWithReconciliation(file: Express.Multer.File): {
    lines: ParsedQuotationRateLineInput[];
    reconciliation: QuotationReconciliationSummary;
  } {
    this.assertExcelQuotationFile(file);
    const lines = parseQuotationRateLinesFromXlsxBuffer(file.buffer);
    const matrix = parseQuotationMatrixFromXlsxBuffer(file.buffer);
    const reconciliation = buildQuotationReconciliation(matrix);
    const hasWfSections = Object.keys(reconciliation.counts).some((k) =>
      ["A/A", "A/B", "B/C"].includes(k),
    );
    if (!reconciliation.isMatch && hasWfSections) {
      throw new BadRequestException(
        `Quotation workbook failed structural reconciliation for OpsFlow WF reference layout: ${reconciliation.warnings.join(
          "; ",
        )}`,
      );
    }
    if (lines.length === 0) {
      throw new BadRequestException(
        "No usable quotation lines found in Excel file",
      );
    }
    return { lines, reconciliation };
  }

  private buildRateExcelLineMetadata(
    l: ParsedQuotationRateLineInput,
    sourceFileName: string,
  ): Prisma.InputJsonValue {
    return {
      ...(l.metadataJson ?? {}),
      annex: l.annex ?? (l.metadataJson as any)?.annex ?? null,
      sectionCode: l.sectionCode ?? (l.metadataJson as any)?.sectionCode ?? null,
      groupTitle: l.groupTitle ?? (l.metadataJson as any)?.groupTitle ?? null,
      sectionDisplay:
        l.sectionDisplay ?? (l.metadataJson as any)?.sectionDisplay ?? null,
      baseCode: l.baseCode ?? (l.metadataJson as any)?.baseCode ?? null,
      baseLabel: l.baseLabel ?? (l.metadataJson as any)?.baseLabel ?? null,
      variantType: l.variantType ?? (l.metadataJson as any)?.variantType ?? null,
      variantLabel:
        l.variantLabel ?? (l.metadataJson as any)?.variantLabel ?? null,
      containerSize:
        l.containerSize ?? (l.metadataJson as any)?.containerSize ?? null,
      equipmentType:
        l.equipmentType ?? (l.metadataJson as any)?.equipmentType ?? null,
      areaScope: l.areaScope ?? (l.metadataJson as any)?.areaScope ?? null,
      itemNo: l.itemNo ?? (l.metadataJson as any)?.itemNo ?? null,
      additionalRuleText:
        l.additionalRuleText ??
        (l.metadataJson as any)?.additionalRuleText ??
        null,
      rawValueText:
        l.rawRateText ?? (l.metadataJson as any)?.rawValueText ?? null,
      parserSourceType:
        (l.metadataJson as any)?.parserSourceType ?? "PARSER_ANNEX_MATRIX",
      section: l.section ?? null,
      category: l.category ?? null,
      notes: l.notes ?? null,
      rawRateText: l.rawRateText ?? null,
      tripMode: l.tripMode ?? null,
      importSource: "RATE_EXCEL",
      sourceFileName,
    } as Prisma.InputJsonValue;
  }

  private mapParsedRateExcelLines(
    lines: ParsedQuotationRateLineInput[],
    sourceFileName: string,
    quotationCurrency = "SGD",
  ): CustomerQuotationLineInputDto[] {
    return lines.map((l, index) => {
      const rateCents = l.rateCents;
      const unitPriceCents =
        rateCents !== null &&
        Number.isInteger(rateCents) &&
        rateCents >= 0
          ? rateCents
          : 0;
      const requiresManualAmount =
        !!l.requiresManualAmount || rateCents == null;
      const taxRate = DEFAULT_TAX_RATE_BP;
      const lineCurrency =
        typeof (l as any).currency === "string" &&
        String((l as any).currency).trim()
          ? String((l as any).currency).trim()
          : quotationCurrency;
      return {
        sortOrder: Number.isInteger(l.sortOrder) ? l.sortOrder : index,
        code: l.code,
        label: l.label,
        description: l.description ?? null,
        unit: l.unit ?? null,
        qty: 1,
        unitPriceCents,
        currency: lineCurrency,
        taxCode: taxRate > 0 ? "SR" : "ZR",
        taxRate,
        requiresManualAmount,
        sourceTemplateRowId: null,
        sourceMasterRowId: null,
        metadataJson: this.buildRateExcelLineMetadata(l, sourceFileName),
      };
    });
  }

  private defaultTitleFromFileName(originalname: string): string {
    const base = String(originalname ?? "").trim() || "quotation";
    return base.replace(/\.[^.]+$/, "") || "quotation";
  }

  async previewFromRateExcel(
    tenantId: string,
    customerId: string,
    file: Express.Multer.File,
  ) {
    await this.assertCustomerCompany(tenantId, customerId);
    const { lines, reconciliation } = this.parseRateExcelWithReconciliation(file);
    const sourceFileName = file.originalname ?? "quotation.xlsx";
    const mapped = this.mapParsedRateExcelLines(lines, sourceFileName, "SGD");
    const items = mapped.map((m, index) => {
      const src = lines[index];
      const meta = (m.metadataJson ?? {}) as Record<string, unknown>;
      return {
        code: m.code,
        label: m.label,
        description: m.description,
        section: (meta.section as string | null | undefined) ?? src?.section ?? null,
        unit: m.unit,
        rateCents: src?.rateCents ?? null,
        unitPriceCents: m.unitPriceCents,
        requiresManualAmount: m.requiresManualAmount,
        rawRateText: src?.rawRateText ?? null,
        notes: src?.notes ?? null,
        sortOrder: m.sortOrder ?? index,
        currency: m.currency ?? "SGD",
        metadataJson: m.metadataJson,
        variantLabel: (meta.variantLabel as string | null | undefined) ?? undefined,
        additionalRuleText:
          (meta.additionalRuleText as string | null | undefined) ?? undefined,
        annex: (meta.annex as string | null | undefined) ?? undefined,
        groupTitle: (meta.groupTitle as string | null | undefined) ?? undefined,
      };
    });
    const validRows = items.filter(
      (i) => String(i.code ?? "").trim() && String(i.label ?? "").trim(),
    ).length;
    return {
      fileName: sourceFileName,
      datasetType: "QUOTATION" as const,
      totalRows: items.length,
      validRows,
      errorCount: 0,
      errors: [] as string[],
      warnings: reconciliation.warnings ?? [],
      reconciliation,
      items,
    };
  }

  async createFromRateExcel(
    tenantId: string,
    customerId: string,
    file: Express.Multer.File,
    dto: CreateCustomerQuotationFromRateExcelDto,
    actorUserId: string | null,
  ) {
    const flightKey = `${tenantId}:${customerId}`;
    if (this.rateExcelCreateInFlight.has(flightKey)) {
      throw new BadRequestException(
        "A rate Excel import is already in progress for this customer",
      );
    }
    this.rateExcelCreateInFlight.add(flightKey);
    try {
      return await this.createFromRateExcelUnlocked(
        tenantId,
        customerId,
        file,
        dto,
        actorUserId,
      );
    } finally {
      this.rateExcelCreateInFlight.delete(flightKey);
    }
  }

  private async createFromRateExcelUnlocked(
    tenantId: string,
    customerId: string,
    file: Express.Multer.File,
    dto: CreateCustomerQuotationFromRateExcelDto,
    actorUserId: string | null,
  ) {
    const company = await this.assertCustomerCompany(tenantId, customerId);
    const { lines } = this.parseRateExcelWithReconciliation(file);
    const sourceFileName = file.originalname ?? "quotation.xlsx";
    const currency = "SGD";
    const lineInputs = this.mapParsedRateExcelLines(
      lines,
      sourceFileName,
      currency,
    );
    const totals = this.computeLineTotals(lineInputs, currency);
    const title =
      dto.title?.trim() || this.defaultTitleFromFileName(sourceFileName);
    const sourceTemplateNameSnapshot = `Excel: ${sourceFileName}`;

    const created = await this.prisma.$transaction(async (tx) => {
      const quotationNo = await this.allocateQuotationNo(tenantId, tx);
      return tx.customerQuotation.create({
        data: {
          tenantId,
          customerCompanyId: customerId,
          quotationNo,
          title,
          status: CustomerQuotationStatus.DRAFT,
          currency,
          notes: null,
          validFrom: null,
          validUntil: null,
          sourceTemplateId: null,
          sourceTemplateNameSnapshot,
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
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "CustomerQuotation",
      created.id,
      {
        quotationNo: created.quotationNo,
        importSource: "RATE_EXCEL",
        sourceFileName,
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
    const incompleteManualLines = quotation.lines.filter(
      (l) =>
        l.requiresManualAmount &&
        (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents <= 0),
    );
    if (incompleteManualLines.length > 0) {
      throw new BadRequestException(
        `Cannot issue quotation: ${incompleteManualLines.length} line(s) require a manual unit price greater than 0 (requiresManualAmount)`,
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
    if (
      quotation.status !== CustomerQuotationStatus.ISSUED &&
      quotation.status !== CustomerQuotationStatus.SIGNED
    ) {
      throw new BadRequestException(
        "Only ISSUED or SIGNED quotations can be accepted",
      );
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
    const fromStatus = quotation.status;
    const result = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId,
        customerCompanyId: customerId,
        status: { in: [CustomerQuotationStatus.ISSUED, CustomerQuotationStatus.SIGNED] },
      },
      data: {
        status: CustomerQuotationStatus.ACCEPTED,
        acceptedAt: now,
        acceptedByUserId: actorUserId,
        acceptanceMethod: dto.acceptanceMethod as CustomerQuotationAcceptanceMethod,
        acceptanceEvidenceNote: evidence,
        acceptanceEvidenceStorageKey:
          dto.acceptanceEvidenceStorageKey ??
          quotation.acceptanceEvidenceStorageKey ??
          quotation.signedDocumentKey ??
          null,
        updatedByUserId: actorUserId,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        "Quotation could not be accepted (no longer ISSUED/SIGNED)",
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
        from: fromStatus,
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
    if (
      quotation.status !== CustomerQuotationStatus.ISSUED &&
      quotation.status !== CustomerQuotationStatus.SIGNED
    ) {
      throw new BadRequestException(
        "Only ISSUED or SIGNED quotations can be rejected",
      );
    }
    const now = new Date();
    const fromStatus = quotation.status;
    const result = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId,
        customerCompanyId: customerId,
        status: { in: [CustomerQuotationStatus.ISSUED, CustomerQuotationStatus.SIGNED] },
      },
      data: {
        status: CustomerQuotationStatus.REJECTED,
        rejectedAt: now,
        updatedByUserId: actorUserId,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        "Quotation could not be rejected (no longer ISSUED/SIGNED)",
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
      { from: fromStatus, to: CustomerQuotationStatus.REJECTED },
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
      quotation.status !== CustomerQuotationStatus.ISSUED &&
      quotation.status !== CustomerQuotationStatus.SIGNED
    ) {
      throw new BadRequestException(
        "Only DRAFT, ISSUED, or SIGNED quotations can be voided",
      );
    }
    const from = quotation.status;
    const now = new Date();
    const result = await this.prisma.customerQuotation.updateMany({
      where: {
        id: quotation.id,
        tenantId,
        customerCompanyId: customerId,
        status: {
          in: [
            CustomerQuotationStatus.DRAFT,
            CustomerQuotationStatus.ISSUED,
            CustomerQuotationStatus.SIGNED,
          ],
        },
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

  private buildSignedDocumentStorageKey(
    tenantId: string,
    customerId: string,
    quotationId: string,
    version: number,
    originalName: string,
  ) {
    const ext = originalName.match(/\.[a-z0-9]+$/i)?.[0] ?? ".pdf";
    return `${tenantId}/companies/${customerId}/customer-quotations/${quotationId}/signed/v${version}${ext}`;
  }

  /**
   * Upload signed customer copy for ISSUED/SIGNED quotations.
   * Never overwrites generated pdfKey. Replaces prior signed copy with version bump + audit.
   */
  async uploadSignedDocument(
    tenantId: string,
    customerId: string,
    id: string,
    file: Express.Multer.File,
    actorUserId: string | null,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("file is required");
    }
    const originalName = String(file.originalname ?? "signed-quotation.pdf");
    const mime = String(file.mimetype ?? "").toLowerCase();
    const isPdf =
      originalName.toLowerCase().endsWith(".pdf") || mime === "application/pdf";
    if (!isPdf) {
      throw new BadRequestException("Signed quotation must be a PDF file");
    }

    const quotation = await this.getById(tenantId, customerId, id);
    if (
      quotation.status !== CustomerQuotationStatus.ISSUED &&
      quotation.status !== CustomerQuotationStatus.SIGNED
    ) {
      throw new BadRequestException(
        "Signed quotation can only be uploaded when status is ISSUED or SIGNED",
      );
    }

    const nextVersion = (quotation.signedDocumentVersion ?? 0) + 1;
    const storageKey = this.buildSignedDocumentStorageKey(
      tenantId,
      customerId,
      quotation.id,
      nextVersion,
      originalName,
    );

    const supabase = this.supabaseService.getClient();
    const { error: uploadError } = await supabase.storage
      .from(QUOTATION_PDF_BUCKET)
      .upload(storageKey, file.buffer, {
        contentType: file.mimetype || "application/pdf",
        upsert: false,
      });
    if (uploadError) {
      throw new BadRequestException(
        `Failed to store signed quotation: ${uploadError.message}`,
      );
    }

    const now = new Date();
    const previousKey = quotation.signedDocumentKey;
    const updated = await this.prisma.customerQuotation.update({
      where: { id: quotation.id },
      data: {
        // Keep generated PDF untouched.
        signedDocumentKey: storageKey,
        signedDocumentOriginalName: originalName,
        signedDocumentUploadedAt: now,
        signedDocumentUploadedByUserId: actorUserId,
        signedDocumentVersion: nextVersion,
        acceptanceEvidenceStorageKey: storageKey,
        status: CustomerQuotationStatus.SIGNED,
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
      quotation.id,
      {
        action: "UPLOAD_SIGNED_DOCUMENT",
        fromStatus: quotation.status,
        toStatus: CustomerQuotationStatus.SIGNED,
        version: nextVersion,
        originalName,
        storageKey,
        previousKey,
        pdfKeyUnchanged: quotation.pdfKey,
      },
      actorUserId,
    );

    return updated;
  }

  async getSignedDocumentUrl(
    tenantId: string,
    customerId: string,
    id: string,
  ) {
    const quotation = await this.getById(tenantId, customerId, id);
    const key =
      quotation.signedDocumentKey || quotation.acceptanceEvidenceStorageKey;
    if (!key) {
      throw new NotFoundException("Signed quotation document not uploaded yet");
    }
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(QUOTATION_PDF_BUCKET)
      .createSignedUrl(key, PDF_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new BadRequestException("Failed to create signed document URL");
    }
    return {
      quotationId: quotation.id,
      quotationNo: quotation.quotationNo,
      signedDocumentKey: key,
      signedDocumentOriginalName: quotation.signedDocumentOriginalName,
      signedDocumentVersion: quotation.signedDocumentVersion,
      signedDocumentUploadedAt: quotation.signedDocumentUploadedAt,
      url: data.signedUrl,
      expiresInSeconds: PDF_SIGNED_URL_TTL_SECONDS,
    };
  }
}
