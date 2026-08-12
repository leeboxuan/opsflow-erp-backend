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

@Injectable()
export class RateTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  async createFromMaster(
    tenantId: string,
    customerId: string,
    dto: CreateRateTemplateFromMasterDto,
    actorUserId: string | null,
  ) {
    await this.assertCustomerCompany(tenantId, customerId);
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("name is required");

    const dataset =
      (await this.prisma.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.QUOTATION,
          isCurrent: true,
        },
        include: {
          rows: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] },
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
          rows: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] },
        },
      }));
    if (!dataset) {
      throw new BadRequestException("No ACTIVE master QUOTATION dataset found");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.customerRateTemplate.create({
        data: {
          tenantId,
          customerCompanyId: customerId,
          name,
          status: CustomerRateTemplateStatus.DRAFT,
          currency: dto.currency?.trim() || "SGD",
          notes: dto.notes ?? null,
          sourceMasterDatasetId: dataset.id,
          sourceMasterDatasetVersionNo: dataset.versionNo,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
      });

      if (dataset.rows.length > 0) {
        await tx.customerRateTemplateRow.createMany({
          data: dataset.rows.map((r, index) => ({
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
            currency: r.currency || "SGD",
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
            sourceMasterRowId: r.id,
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
      {
        customerCompanyId: customerId,
        fromMasterDatasetId: dataset.id,
        versionNo: dataset.versionNo,
        rowCount: dataset.rows.length,
      },
      actorUserId,
    );
    return created!;
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
