import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CustomerRateTemplateStatus,
  MasterRateDatasetStatus,
  MasterRateDatasetType,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { AuditService } from "../../shared/audit/audit.service";
import {
  CreateBlankRateTemplateDto,
  CreateRateTemplateFromMasterDto,
  DuplicateRateTemplateDto,
  RateTemplateRowInputDto,
  UpdateRateTemplateDto,
} from "./rate-templates.dto";

export const SEEDED_CUSTOMER_RATE_TEMPLATE_NAME = "Default rate template";

/** Root Prisma client or an interactive-transaction client. Do not nest `$transaction`. */
export type RateTemplateDbClient = PrismaService | Prisma.TransactionClient;

export type CreateFromMasterOptions = {
  /**
   * When set, copy work joins this transaction and does not open a nested
   * `$transaction`. Audit is left to the caller so it cannot commit independently.
   */
  client?: RateTemplateDbClient;
  /**
   * When set (including `[]`), seed these customized rows instead of copying
   * every current quotation-base row. Provenance still points at the current
   * master dataset when one exists.
   */
  rows?: RateTemplateRowInputDto[];
};

@Injectable()
export class RateTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertCustomerCompany(
    tenantId: string,
    customerCompanyId: string,
    client: RateTemplateDbClient = this.prisma,
  ) {
    const company = await client.customer_companies.findFirst({
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
      throw new NotFoundException("Rate template not found");
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

  private normalizeRow(
    tenantId: string,
    templateId: string,
    row: RateTemplateRowInputDto,
    index: number,
    actorUserId: string | null,
  ): Prisma.CustomerRateTemplateRowCreateManyInput {
    const code = String(row.code ?? "").trim();
    const label = String(row.label ?? "").trim();
    if (!code || !label) {
      throw new BadRequestException("Each row requires non-empty code and label");
    }
    if (
      row.rateCents !== null &&
      row.rateCents !== undefined &&
      (!Number.isInteger(Number(row.rateCents)) || Number(row.rateCents) < 0)
    ) {
      throw new BadRequestException(`Invalid rateCents for row ${code}`);
    }
    return {
      tenantId,
      templateId,
      code,
      label,
      section: row.section ?? null,
      description: row.description ?? null,
      category: row.category ?? null,
      unit: row.unit ?? null,
      containerSize: row.containerSize ?? null,
      tripMode: row.tripMode ?? null,
      areaScope: row.areaScope ?? null,
      currency: row.currency?.trim() || "SGD",
      rateCents:
        row.rateCents === null || row.rateCents === undefined
          ? null
          : Number(row.rateCents),
      rawRateText: row.rawRateText ?? null,
      requiresManualAmount: !!row.requiresManualAmount,
      hasMultipleRates: !!row.hasMultipleRates,
      rateOptionsJson:
        row.rateOptionsJson === undefined
          ? undefined
          : (row.rateOptionsJson as Prisma.InputJsonValue),
      defaultRateOptionIndex: row.defaultRateOptionIndex ?? null,
      notes: row.notes ?? null,
      sortOrder:
        row.sortOrder === null || row.sortOrder === undefined
          ? index
          : Number(row.sortOrder),
      isActive: row.isActive !== false,
      metadataJson:
        row.metadataJson === undefined
          ? undefined
          : (row.metadataJson as Prisma.InputJsonValue),
      sourceMasterRowId: row.sourceMasterRowId ?? null,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    };
  }

  async list(tenantId: string, customerId: string) {
    await this.assertCustomerCompany(tenantId, customerId);
    return this.prisma.customerRateTemplate.findMany({
      where: { tenantId, customerCompanyId: customerId },
      orderBy: [{ updatedAt: "desc" }],
      include: { _count: { select: { rows: true } } },
    });
  }

  async getById(tenantId: string, customerId: string, id: string) {
    await this.assertCustomerCompany(tenantId, customerId);
    const template = await this.prisma.customerRateTemplate.findFirst({
      where: { tenantId, id },
      include: {
        rows: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] },
      },
    });
    if (!template) throw new NotFoundException("Rate template not found");
    this.assertSameCustomer(template.customerCompanyId, customerId);
    return template;
  }

  async createBlank(
    tenantId: string,
    customerId: string,
    dto: CreateBlankRateTemplateDto,
    actorUserId: string | null,
  ) {
    await this.assertCustomerCompany(tenantId, customerId);
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("name is required");

    const created = await this.prisma.customerRateTemplate.create({
      data: {
        tenantId,
        customerCompanyId: customerId,
        name,
        status: CustomerRateTemplateStatus.DRAFT,
        currency: dto.currency?.trim() || "SGD",
        notes: dto.notes ?? null,
        effectiveFrom: this.parseOptionalDate(dto.effectiveFrom) ?? null,
        effectiveTo: this.parseOptionalDate(dto.effectiveTo) ?? null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
      include: { rows: true },
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "CustomerRateTemplate",
      created.id,
      { customerCompanyId: customerId, name: created.name },
      actorUserId,
    );
    return created;
  }

  private quotationDatasetInclude() {
    return {
      rows: { orderBy: [{ sortOrder: "asc" as const }, { code: "asc" as const }, { id: "asc" as const }] },
    };
  }

  private templateRowCreateData(
    tenantId: string,
    templateId: string,
    r: Record<string, any>,
    index: number,
    opts: { actorUserId: string | null; sourceMasterRowId?: string | null },
  ) {
    return {
      tenantId,
      templateId,
      code: r.code,
      label: r.label,
      section: r.section ?? null,
      description: r.description ?? null,
      category: r.category ?? null,
      unit: r.unit ?? null,
      containerSize: r.containerSize ?? null,
      tripMode: r.tripMode ?? null,
      areaScope: r.areaScope ?? null,
      currency: r.currency || "SGD",
      rateCents: r.rateCents ?? null,
      rawRateText: r.rawRateText ?? null,
      requiresManualAmount: !!r.requiresManualAmount,
      hasMultipleRates: !!r.hasMultipleRates,
      rateOptionsJson:
        r.rateOptionsJson == null
          ? undefined
          : (r.rateOptionsJson as Prisma.InputJsonValue),
      defaultRateOptionIndex: r.defaultRateOptionIndex ?? null,
      notes: r.notes ?? null,
      sortOrder: r.sortOrder ?? index,
      isActive: r.isActive !== false,
      metadataJson:
        r.metadataJson == null
          ? undefined
          : (r.metadataJson as Prisma.InputJsonValue),
      sourceMasterRowId: opts.sourceMasterRowId ?? null,
      createdByUserId: opts.actorUserId,
      updatedByUserId: opts.actorUserId,
    };
  }

  private async seedCustomizedDefaultRates(
    db: RateTemplateDbClient,
    params: {
      tenantId: string;
      customerId: string;
      name: string;
      notes: string;
      actorUserId: string | null;
      dataset: { id: string; versionNo: number } | null;
      rows: RateTemplateRowInputDto[];
      joinsOuterTx: boolean;
    },
  ) {
    await this.assertCustomerCompany(params.tenantId, params.customerId, db);
    const copy = async (tx: RateTemplateDbClient) => {
      const template = await tx.customerRateTemplate.create({
        data: {
          tenantId: params.tenantId,
          customerCompanyId: params.customerId,
          name: params.name,
          status: CustomerRateTemplateStatus.DRAFT,
          currency: "SGD",
          notes: params.notes,
          sourceMasterDatasetId: params.dataset?.id ?? null,
          sourceMasterDatasetVersionNo: params.dataset?.versionNo ?? null,
          createdByUserId: params.actorUserId,
          updatedByUserId: params.actorUserId,
        },
      });
      if (params.rows.length > 0) {
        await tx.customerRateTemplateRow.createMany({
          data: params.rows.map((r, index) =>
            this.templateRowCreateData(params.tenantId, template.id, r, index, {
              actorUserId: params.actorUserId,
              sourceMasterRowId: r.sourceMasterRowId ?? null,
            }),
          ),
        });
      }
      return tx.customerRateTemplate.findFirst({
        where: { tenantId: params.tenantId, id: template.id },
        include: {
          rows: {
            orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
          },
        },
      });
    };

    const created = params.joinsOuterTx
      ? await copy(db)
      : await this.prisma.$transaction(async (tx) => copy(tx));

    if (!params.joinsOuterTx) {
      await this.audit.log(
        params.tenantId,
        "CREATE",
        "CustomerRateTemplate",
        created!.id,
        {
          customerCompanyId: params.customerId,
          fromMasterDatasetId: params.dataset?.id ?? null,
          versionNo: params.dataset?.versionNo ?? null,
          rowCount: params.rows.length,
          customizedOnCustomerCreate: true,
        },
        params.actorUserId,
      );
    }
    return created!;
  }

  private async findPreferredQuotationDataset(
    tenantId: string,
    client: RateTemplateDbClient = this.prisma,
  ) {
    return (
      (await client.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.QUOTATION,
          isCurrent: true,
        },
        include: this.quotationDatasetInclude(),
      })) ??
      (await client.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.QUOTATION,
          status: MasterRateDatasetStatus.ACTIVE,
        },
        orderBy: { versionNo: "desc" },
        include: this.quotationDatasetInclude(),
      }))
    );
  }

  private async copyQuotationDatasetToCustomerTemplate(
    tx: RateTemplateDbClient,
    params: {
      tenantId: string;
      customerId: string;
      name: string;
      notes: string | null;
      currency: string;
      actorUserId: string | null;
      dataset: {
        id: string;
        versionNo: number;
        rows: Array<Record<string, any>>;
      };
    },
  ) {
    const template = await tx.customerRateTemplate.create({
      data: {
        tenantId: params.tenantId,
        customerCompanyId: params.customerId,
        name: params.name,
        status: CustomerRateTemplateStatus.DRAFT,
        currency: params.currency,
        notes: params.notes,
        sourceMasterDatasetId: params.dataset.id,
        sourceMasterDatasetVersionNo: params.dataset.versionNo,
        createdByUserId: params.actorUserId,
        updatedByUserId: params.actorUserId,
      },
    });

    if (params.dataset.rows.length > 0) {
      await tx.customerRateTemplateRow.createMany({
        data: params.dataset.rows.map((r, index) =>
          this.templateRowCreateData(params.tenantId, template.id, r, index, {
            actorUserId: params.actorUserId,
            sourceMasterRowId:
              r.sourceMasterRowId !== undefined ? r.sourceMasterRowId : r.id,
          }),
        ),
      });
    }

    return tx.customerRateTemplate.findFirst({
      where: { tenantId: params.tenantId, id: template.id },
      include: {
        rows: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] },
      },
    });
  }

  async createFromMaster(
    tenantId: string,
    customerId: string,
    dto: CreateRateTemplateFromMasterDto,
    actorUserId: string | null,
    opts?: CreateFromMasterOptions,
  ) {
    const db = opts?.client ?? this.prisma;
    const joinsOuterTx = !!opts?.client;
    await this.assertCustomerCompany(tenantId, customerId, db);
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("name is required");

    const dataset = await this.findPreferredQuotationDataset(tenantId, db);
    if (!dataset) {
      throw new BadRequestException("No ACTIVE master QUOTATION dataset found");
    }

    const copy = (tx: RateTemplateDbClient) =>
      this.copyQuotationDatasetToCustomerTemplate(tx, {
        tenantId,
        customerId,
        name,
        notes: dto.notes ?? null,
        currency: dto.currency?.trim() || "SGD",
        actorUserId,
        dataset,
      });

    const created = joinsOuterTx
      ? await copy(db)
      : await this.prisma.$transaction(async (tx) => copy(tx));

    if (!joinsOuterTx) {
      await this.audit.log(
        tenantId,
        "CREATE",
        "CustomerRateTemplate",
        created!.id,
        {
          customerCompanyId: customerId,
          fromMasterDatasetId: dataset.id,
          versionNo: dataset.versionNo,
          rowCount: dataset.rows.length,
        },
        actorUserId,
      );
    }
    return created!;
  }

  /**
   * Deep-copy the current quotation base template into a new customer rate
   * template. Returns null when no current/ACTIVE quotation base exists so
   * customer create can proceed without commercial setup.
   */
  async seedFromCurrentQuotationBase(
    tenantId: string,
    customerId: string,
    actorUserId: string | null,
    companyName?: string | null,
    opts?: CreateFromMasterOptions,
  ) {
    const db = opts?.client ?? this.prisma;
    const dataset = await this.findPreferredQuotationDataset(tenantId, db);
    const customized = opts?.rows;
    if (!dataset && customized === undefined) return null;

    const name = companyName?.trim()
      ? `${companyName.trim()} — ${SEEDED_CUSTOMER_RATE_TEMPLATE_NAME}`
      : SEEDED_CUSTOMER_RATE_TEMPLATE_NAME;
    const notes =
      "Independent copy of the quotation base template at customer creation. Later base-template edits do not rewrite this copy.";

    if (customized !== undefined) {
      return this.seedCustomizedDefaultRates(db, {
        tenantId,
        customerId,
        name,
        notes,
        actorUserId,
        dataset,
        rows: customized,
        joinsOuterTx: !!opts?.client,
      });
    }

    if (!dataset) return null;

    return this.createFromMaster(
      tenantId,
      customerId,
      { name, notes },
      actorUserId,
      opts,
    );
  }

  async duplicate(
    tenantId: string,
    customerId: string,
    id: string,
    dto: DuplicateRateTemplateDto,
    actorUserId: string | null,
  ) {
    const source = await this.getById(tenantId, customerId, id);
    const name =
      String(dto.name ?? "").trim() || `Copy of ${source.name}`;

    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.customerRateTemplate.create({
        data: {
          tenantId,
          customerCompanyId: customerId,
          name,
          status: CustomerRateTemplateStatus.DRAFT,
          currency: source.currency,
          effectiveFrom: source.effectiveFrom,
          effectiveTo: source.effectiveTo,
          notes: source.notes,
          sourceMasterDatasetId: source.sourceMasterDatasetId,
          sourceMasterDatasetVersionNo: source.sourceMasterDatasetVersionNo,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
      });

      if (source.rows.length > 0) {
        await tx.customerRateTemplateRow.createMany({
          data: source.rows.map((r, index) => ({
            tenantId,
            templateId: template.id,
            code: r.code,
            label: r.label,
            section: r.section,
            description: r.description,
            category: r.category,
            unit: r.unit,
            containerSize: r.containerSize,
            tripMode: r.tripMode,
            areaScope: r.areaScope,
            currency: r.currency,
            rateCents: r.rateCents,
            rawRateText: r.rawRateText,
            requiresManualAmount: r.requiresManualAmount,
            hasMultipleRates: r.hasMultipleRates,
            rateOptionsJson:
              r.rateOptionsJson == null
                ? undefined
                : (r.rateOptionsJson as Prisma.InputJsonValue),
            defaultRateOptionIndex: r.defaultRateOptionIndex,
            notes: r.notes,
            sortOrder: r.sortOrder ?? index,
            isActive: r.isActive,
            metadataJson:
              r.metadataJson == null
                ? undefined
                : (r.metadataJson as Prisma.InputJsonValue),
            sourceMasterRowId: r.sourceMasterRowId,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          })),
        });
      }

      return tx.customerRateTemplate.findFirst({
        where: { tenantId, id: template.id },
        include: {
          rows: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] },
        },
      });
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "CustomerRateTemplate",
      created!.id,
      { duplicatedFromId: source.id, customerCompanyId: customerId },
      actorUserId,
    );
    return created!;
  }

  async update(
    tenantId: string,
    customerId: string,
    id: string,
    dto: UpdateRateTemplateDto,
    actorUserId: string | null,
  ) {
    const existing = await this.getById(tenantId, customerId, id);
    const data: Prisma.CustomerRateTemplateUncheckedUpdateInput = {
      updatedByUserId: actorUserId,
    };
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("name cannot be empty");
      data.name = name;
    }
    if (dto.status !== undefined) {
      data.status = dto.status as CustomerRateTemplateStatus;
    }
    if (dto.currency !== undefined) {
      data.currency = dto.currency.trim() || existing.currency;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.effectiveFrom !== undefined) {
      data.effectiveFrom = this.parseOptionalDate(dto.effectiveFrom) ?? null;
    }
    if (dto.effectiveTo !== undefined) {
      data.effectiveTo = this.parseOptionalDate(dto.effectiveTo) ?? null;
    }

    const updated = await this.prisma.customerRateTemplate.update({
      where: { id: existing.id },
      data,
      include: {
        rows: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] },
      },
    });

    await this.audit.log(
      tenantId,
      "UPDATE",
      "CustomerRateTemplate",
      updated.id,
      { fields: Object.keys(dto) },
      actorUserId,
    );
    return updated;
  }

  async replaceRows(
    tenantId: string,
    customerId: string,
    id: string,
    rows: RateTemplateRowInputDto[],
    actorUserId: string | null,
  ) {
    const existing = await this.getById(tenantId, customerId, id);
    const normalized = (rows ?? []).map((row, index) =>
      this.normalizeRow(tenantId, existing.id, row, index, actorUserId),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customerRateTemplateRow.deleteMany({
        where: { tenantId, templateId: existing.id },
      });
      if (normalized.length > 0) {
        await tx.customerRateTemplateRow.createMany({ data: normalized });
      }
      await tx.customerRateTemplate.update({
        where: { id: existing.id },
        data: { updatedByUserId: actorUserId },
      });
      return tx.customerRateTemplate.findFirst({
        where: { tenantId, id: existing.id },
        include: {
          rows: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] },
        },
      });
    });

    await this.audit.log(
      tenantId,
      "UPDATE",
      "CustomerRateTemplate",
      existing.id,
      { action: "REPLACE_ROWS", rowCount: normalized.length },
      actorUserId,
    );
    return updated!;
  }
}
