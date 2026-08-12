import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { SupabaseService } from "../../shared/auth/supabase.service";
import { AuditService } from "../../shared/audit/audit.service";
import {
  LogisticsLocationType,
  MasterFileStatus,
  MasterFileType,
  MasterRateDatasetStatus,
  MasterRateDatasetType,
  Prisma,
} from "@prisma/client";
import {
  buildQuotationReconciliation,
  parseQuotationMatrixFromXlsxBuffer,
  parseQuotationRateLinesFromXlsxBuffer,
} from "../../customers/quotation-parse.helpers";
import { parseDhcExcelBuffer } from "./parsers/dhc-excel.parser";
import {
  CreateDriverTripRateMasterDto,
  DriverTripRateImportSummaryDto,
  UpdateDriverTripRateMasterDto,
} from "./dto/driver-trip-rate-master.dto";

@Injectable()
export class MasterDataService {
  private readonly logger = new Logger(MasterDataService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly audit: AuditService = {
      log: async () => undefined,
    } as unknown as AuditService,
  ) {}
  private readonly MASTER_BUCKET = "job-documents";

  listSingaporePorts() {
    return this.prisma.masterSingaporePort
      .findMany({
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          postalCode: true,
          country: true,
          lat: true,
          lng: true,
          placeId: true,
        },
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          label: `${row.code} — ${row.name}`,
        })),
      );
  }

  listSingaporeDepots() {
    return this.prisma.masterSingaporeDepot
      .findMany({
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          postalCode: true,
          country: true,
          lat: true,
          lng: true,
          placeId: true,
        },
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          label: `${row.code} — ${row.name}`,
        })),
      );
  }

  listTrailerLocations() {
    return this.prisma.masterTrailerLocation.findMany({
      orderBy: { code: "asc" },
    });
  }

  listLogisticsLocations(type?: LogisticsLocationType) {
    return this.prisma.masterLogisticsLocation
      .findMany({
        where: {
          ...(type ? { type } : {}),
          isActive: true,
        },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          label: true,
          type: true,
          addressLine1: true,
          addressLine2: true,
          postalCode: true,
          country: true,
          lat: true,
          lng: true,
          placeId: true,
        },
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          label: row.label ?? `${row.code} — ${row.name}`,
        })),
      );
  }

  async getLogisticsLocationById(id: string) {
    const row = await this.prisma.masterLogisticsLocation.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        label: true,
        type: true,
        addressLine1: true,
        addressLine2: true,
        postalCode: true,
        country: true,
        lat: true,
        lng: true,
        placeId: true,
        isActive: true,
      },
    });
    if (!row || !row.isActive) {
      throw new NotFoundException("Logistics location not found");
    }
    return {
      ...row,
      label: row.label ?? `${row.code} — ${row.name}`,
    };
  }

  private async uploadMasterObject(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage.from(this.MASTER_BUCKET).upload(storageKey, buffer, {
      contentType,
      upsert: false,
    });
    if (error) throw new BadRequestException(`Storage upload failed: ${error.message}`);
  }

  private parseMoney(raw: unknown): number | null {
    const n = Number(String(raw ?? "").replace(/[$,\s]/g, ""));
    if (Number.isNaN(n)) return null;
    return Math.round(n * 100);
  }

  private parseDate(effectiveDateIso?: string | null): Date | null {
    if (!effectiveDateIso || !String(effectiveDateIso).trim()) return null;
    const d = new Date(String(effectiveDateIso).trim() + "T00:00:00.000Z");
    if (Number.isNaN(d.getTime())) throw new BadRequestException("effectiveDate must be YYYY-MM-DD");
    return d;
  }

  private inferMimeFromFileName(fileName: string): string {
    const name = String(fileName ?? "").toLowerCase();
    if (name.endsWith(".pdf")) return "application/pdf";
    if (name.endsWith(".docx")) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    if (name.endsWith(".xlsx")) {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (name.endsWith(".xls")) return "application/vnd.ms-excel";
    return "application/octet-stream";
  }

  private async downloadMasterObject(storageKey: string): Promise<Buffer> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(this.MASTER_BUCKET)
      .download(storageKey);
    if (error || !data) {
      throw new BadRequestException(
        `Failed to download master file from storage: ${error?.message ?? "unknown error"}`,
      );
    }
    const raw: any = data;
    if (Buffer.isBuffer(raw)) return raw;
    if (typeof raw?.arrayBuffer === "function") {
      return Buffer.from(await raw.arrayBuffer());
    }
    if (typeof raw === "string") return Buffer.from(raw);
    return Buffer.from(raw);
  }

  private async parseQuotationItemsFromFile(file: Express.Multer.File) {
    const mime = String(file.mimetype ?? "").toLowerCase();
    const name = String(file.originalname ?? "").toLowerCase();
    const isExcel = /\.xlsx?$/i.test(name);
    if (!isExcel) {
      throw new BadRequestException("QUOTATION master upload must be Excel (.xlsx/.xls)");
    }
    const lines = parseQuotationRateLinesFromXlsxBuffer(file.buffer);
    const matrix = parseQuotationMatrixFromXlsxBuffer(file.buffer);
    const reconciliation = buildQuotationReconciliation(matrix);
    const hasWfSections =
      Object.keys(reconciliation.counts).some((k) => ["A/A", "A/B", "B/C"].includes(k));
    if (!reconciliation.isMatch && hasWfSections) {
      throw new BadRequestException(
        `Quotation workbook failed structural reconciliation for OpsFlow WF reference layout: ${reconciliation.warnings.join(
          "; ",
        )}`,
      );
    }

    if (lines.length > 0) {
      const parsedWithManualAmountCount = lines.filter((l) => l.requiresManualAmount).length;
      return {
        items: lines.map((l) => ({
          section: l.section ?? null,
          code: l.code,
          label: l.label,
          description: l.description ?? null,
          category: l.category ?? null,
          containerSize: l.containerSize ?? null,
          tripMode: l.tripMode ?? null,
          areaScope: l.areaScope ?? null,
          unit: l.unit ?? null,
          rateCents: l.rateCents,
          notes: l.notes ?? l.rawRateText ?? null,
          requiresManualAmount: !!l.requiresManualAmount,
          rawRateText: l.rawRateText ?? null,
          sortOrder: l.sortOrder,
          active: true,
        })),
        summary: {
          lineCount: lines.length,
          parsedWithManualAmountCount,
          reconciliation,
          note: "Structured quotation rows parsed from Excel upload.",
        },
        status: MasterFileStatus.PARSED,
      };
    }

    return {
      items: [] as any[],
      summary: { note: "No structured quotation rows parsed from uploaded Excel file." },
      status: MasterFileStatus.PARSE_FAILED,
    };
  }

  private parseControlledSheetRows(buffer: Buffer) {
    let XLSX: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      XLSX = require("xlsx");
    } catch {
      throw new BadRequestException("Excel import requires xlsx package");
    }
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName =
      wb.SheetNames.find((n: string) =>
        String(n).trim().toLowerCase() === "latest rates",
      ) ?? wb.SheetNames[0];
    if (!sheetName) return null;
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (!rows.length) return null;
    return { rows, sheetName };
  }

  private parseDriverPayoutItems(buffer: Buffer) {
    const parsed = this.parseControlledSheetRows(buffer);
    if (!parsed || !parsed.rows.length) {
      return {
        items: [],
        summary: { note: "No rows found", sheetUsed: null, totalParsedRows: 0, skippedRows: 0, warnings: [] },
      };
    }
    const { rows, sheetName } = parsed;
    const items: any[] = [];
    const warnings: string[] = [];
    const codeCounter = new Map<string, number>();
    let skippedRows = 0;
    let parsedWithManualAmountCount = 0;
    let currentSectionCode: string | null = null;
    let currentSectionTitle: string | null = null;
    let pendingSectionTitle = false;

    const parseNumericRate = (raw: unknown): number | null => {
      if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
      const s = String(raw ?? "").trim();
      if (!s) return null;
      // only accept plain single numeric values for payout rows
      if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
      const n = Number(s);
      if (Number.isNaN(n)) return null;
      return n;
    };

    const parseRateCell = (
      raw: unknown,
    ): { rateCents: number | null; requiresManualAmount: boolean; rawRateText: string | null } => {
      const rawText = String(raw ?? "").trim();
      if (!rawText) return { rateCents: null, requiresManualAmount: false, rawRateText: null };

      const moneyLikeMatches =
        rawText.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g)?.filter(Boolean) ?? [];
      const hasAmbiguousDelimiter =
        rawText.includes("/") || /\bto\b/i.test(rawText) || /\bor\b/i.test(rawText);
      if (moneyLikeMatches.length >= 2 && hasAmbiguousDelimiter) {
        return { rateCents: null, requiresManualAmount: true, rawRateText: rawText };
      }

      const numericRate = parseNumericRate(raw);
      if (numericRate == null) {
        return { rateCents: null, requiresManualAmount: false, rawRateText: null };
      }
      return { rateCents: numericRate, requiresManualAmount: false, rawRateText: null };
    };

    const normalizeSectionTitle = (sectionCode: string, rawTitle: string): string | null => {
      const cleaned = rawTitle.trim().replace(/\s+/g, " ");
      if (cleaned) return cleaned;
      if (sectionCode === "E") return "Fixed Monthly Payments";
      return null;
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!Array.isArray(r)) continue;
      const colA = String(r[0] ?? "").trim();
      const colB = String(r[1] ?? "").trim();
      const colC = String(r[2] ?? "").trim();
      const colD = r[3];

      if (!colA && !colB && !colC && String(colD ?? "").trim() === "") {
        continue;
      }

      // Section start row: any section letter in col A (A/B/C/D/E...)
      if (/^[A-Z]$/.test(colA)) {
        currentSectionCode = colA;
        currentSectionTitle = normalizeSectionTitle(colA, colB);
        pendingSectionTitle = !currentSectionTitle;
        continue;
      }

      // Some sheets place section title on a separate row after section letter (e.g. "E" then "Fixed Monthly Payments")
      if (
        pendingSectionTitle &&
        !/^(description|uom|rates?)$/i.test(colA) &&
        !/^(description|uom|rates?)$/i.test(colB) &&
        !/^\d+$/.test(colA) &&
        String(colD ?? "").trim() === ""
      ) {
        const rowTitle = [colA, colB, colC].map((v) => v.trim()).find(Boolean) ?? "";
        currentSectionTitle = normalizeSectionTitle(currentSectionCode ?? "", rowTitle);
        pendingSectionTitle = false;
        continue;
      }

      // Skip obvious table header rows
      if (
        /^(description|uom|rates?)$/i.test(colA) ||
        /^(description|uom|rates?)$/i.test(colB)
      ) {
        pendingSectionTitle = false;
        skippedRows += 1;
        continue;
      }

      // Item row: numeric item number in col A + description in col B + rate in col D
      if (/^\d+$/.test(colA) && colB) {
        const parsedRate = parseRateCell(colD);
        const isManualAmount = parsedRate.requiresManualAmount;
        if (
          (!isManualAmount && parsedRate.rateCents == null) ||
          (parsedRate.rateCents != null && parsedRate.rateCents < 0)
        ) {
          skippedRows += 1;
          const rawRate = String(colD ?? "").trim();
          if (rawRate) {
            warnings.push(
              `Skipped row ${i + 1}: non-single numeric rate "${rawRate}"`,
            );
          }
          continue;
        }

        const baseCode = `${currentSectionCode ?? "X"}-${colA}`;
        const seen = codeCounter.get(baseCode) ?? 0;
        const nextSeen = seen + 1;
        codeCounter.set(baseCode, nextSeen);
        const code = nextSeen > 1 ? `${baseCode}-${nextSeen}` : baseCode;
        if (nextSeen > 1) {
          warnings.push(
            `Duplicate base code "${baseCode}" at row ${i + 1}; generated "${code}"`,
          );
        }
        const label = colB;
        const rateCents =
          parsedRate.rateCents == null ? null : Math.round(parsedRate.rateCents * 100);
        if (isManualAmount) parsedWithManualAmountCount += 1;

        items.push({
          section: currentSectionCode,
          code,
          label,
          description: null,
          category: currentSectionTitle,
          containerSize: null,
          tripMode: null,
          areaScope: null,
          unit: colC || null,
          rateCents,
          notes: parsedRate.rawRateText,
          requiresManualAmount: isManualAmount,
          rawRateText: parsedRate.rawRateText,
          isSelectableForTripEarning: !isManualAmount,
          sortOrder: items.length,
          active: true,
        });
        if (isManualAmount) {
          warnings.push(
            `Parsed row ${i + 1} with ambiguous rate "${parsedRate.rawRateText}" as manual-amount item`,
          );
        }
        continue;
      }

      skippedRows += 1;
      if (colA || colB || colC || String(colD ?? "").trim()) {
        warnings.push(`Skipped row ${i + 1}: not a recognized payout item row`);
      }
    }

    if (!items.length) {
      warnings.push("No parseable payout item rows were found in the workbook.");
    }

    return {
      items,
      summary: {
        sheetUsed: sheetName,
        totalParsedRows: items.length,
        parsedWithManualAmountCount,
        skippedRows,
        warnings,
      },
    };
  }

  private async parseDhcItems(file: Express.Multer.File) {
    const name = String(file.originalname ?? "").toLowerCase();
    const isExcel = /\.xlsx$/i.test(name);
    if (!isExcel) {
      return {
        items: [],
        summary: {
          parserVersion: "dhc_excel_v1",
          parsedRows: 0,
          skippedRows: 0,
          warnings: ["DHC_REFERENCE canonical import requires .xlsx source file."],
          note: "DHC upload accepted but not parsed: please upload Excel (.xlsx) source file.",
        },
        status: MasterFileStatus.PARSE_FAILED,
      };
    }
    const parsed = parseDhcExcelBuffer(file.buffer);
    const dedupedItems: any[] = [];
    const seen = new Set<string>();
    let duplicateRowsRemoved = 0;
    for (const row of parsed.items) {
      const key = [
        row.yardDepot ?? "",
        row.operatorCode ?? "",
        row.operatorName ?? "",
        row.oldRateCents ?? "",
        row.newRateCents ?? "",
        row.software ?? "",
        row.effectiveDate ? row.effectiveDate.toISOString().slice(0, 10) : "",
      ].join("|");
      if (seen.has(key)) {
        duplicateRowsRemoved += 1;
        continue;
      }
      seen.add(key);
      dedupedItems.push(row);
    }
    const items = dedupedItems.map((row, idx) => ({
      section: row.section,
      code: row.code,
      label: row.label,
      description: row.description,
      category: row.category,
      unit: row.unit,
      rateCents: row.rateCents,
      notes: row.notes,
      yardDepot: row.yardDepot,
      oldRateCents: row.oldRateCents,
      newRateCents: row.newRateCents,
      software: row.software,
      operatorCode: row.operatorCode,
      operatorName: row.operatorName,
      effectiveDate: row.effectiveDate,
      sortOrder: idx,
      active: true,
    }));
    const summary = {
      ...parsed.summary,
      parsedRows: items.length,
      duplicateRowsRemoved,
      lineCount: items.length,
    };
    return {
      items,
      summary: {
        ...summary,
        note: items.length
          ? "DHC Excel parsed as deterministic canonical source."
          : "DHC Excel parsed but no valid rows detected.",
      },
      status: items.length ? MasterFileStatus.PARSED : MasterFileStatus.PARSE_FAILED,
    };
  }

  async uploadAndParseMasterFile(
    tenantId: string,
    type: MasterFileType,
    file: Express.Multer.File,
    uploadedByUserId: string | null,
    effectiveDateIso?: string | null,
    customerCompanyId?: string | null,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    const effectiveDate = this.parseDate(effectiveDateIso);
    const providedCustomerCompanyId = customerCompanyId?.trim() || null;
    const scopedCustomerCompanyId = null;
    if (type === MasterFileType.QUOTATION && providedCustomerCompanyId) {
      throw new BadRequestException(
        "QUOTATION must be tenant-scoped; customerCompanyId must be null",
      );
    }
    if (
      (type === MasterFileType.DRIVER_PAYOUT ||
        type === MasterFileType.DHC_REFERENCE) &&
      providedCustomerCompanyId
    ) {
      throw new BadRequestException(
        `${type} must be tenant-scoped; customerCompanyId must be null`,
      );
    }
    if (type === MasterFileType.CUSTOMER_QUOTATION) {
      throw new BadRequestException(
        "CUSTOMER_QUOTATION master upload is deprecated. Use QUOTATION.",
      );
    }
    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".bin";
    const key = `${tenantId}/masters/${type.toLowerCase()}/${Date.now()}${ext}`;
    await this.uploadMasterObject(key, file.buffer, file.mimetype ?? "application/octet-stream");

    let parsed:
      | { items: any[]; summary: Record<string, unknown>; status?: MasterFileStatus }
      | undefined;
    if (type === MasterFileType.QUOTATION) {
      parsed = await this.parseQuotationItemsFromFile(file);
    } else if (type === MasterFileType.DRIVER_PAYOUT) {
      parsed = this.parseDriverPayoutItems(file.buffer);
    } else {
      parsed = await this.parseDhcItems(file);
    }

    const status = parsed.status ?? (parsed.items.length > 0 ? MasterFileStatus.PARSED : MasterFileStatus.PARSE_FAILED);

    const shouldActivateNewFile = !(
      type === MasterFileType.DHC_REFERENCE && status === MasterFileStatus.PARSE_FAILED
    );
    const masterFile = await this.prisma.$transaction(async (tx) => {
      if (shouldActivateNewFile) {
        await tx.masterFile.updateMany({
          where: {
            tenantId,
            type,
            isActive: true,
            customerCompanyId: null,
          },
          data: { isActive: false, status: MasterFileStatus.SUPERSEDED },
        });
      }
      const mf = await tx.masterFile.create({
        data: {
          tenantId,
          customerCompanyId: scopedCustomerCompanyId,
          type,
          fileName: file.originalname ?? "upload",
          fileUrl: key,
          uploadedByUserId: uploadedByUserId ?? null,
          uploadedAt: new Date(),
          effectiveDate,
          status,
          parseSummaryJson: parsed.summary as Prisma.InputJsonValue,
          isActive: shouldActivateNewFile,
        },
      });
      if (type === MasterFileType.QUOTATION && parsed.items.length) {
        await tx.customerQuotationItem.createMany({
          data: parsed.items.map((r) => ({ tenantId, masterFileId: mf.id, ...r })),
        });
      }
      if (type === MasterFileType.DRIVER_PAYOUT && parsed.items.length) {
        await tx.driverPayoutItem.createMany({
          data: parsed.items.map((r) => ({ tenantId, masterFileId: mf.id, ...r })),
        });
      }
      if (type === MasterFileType.DHC_REFERENCE && parsed.items.length) {
        await tx.dhcReferenceItem.createMany({
          data: parsed.items.map((r) => ({ tenantId, masterFileId: mf.id, ...r })),
        });
      }
      return mf;
    });
    return masterFile;
  }

  async listMasterFiles(tenantId: string, type?: MasterFileType) {
    return this.prisma.masterFile.findMany({
      where: { tenantId, ...(type ? { type } : {}) },
      orderBy: { uploadedAt: "desc" },
    });
  }

  async getActiveMasterItems(
    tenantId: string,
    type: MasterFileType,
    customerCompanyId?: string | null,
  ) {
    let activeWhere: any;
    if (type === MasterFileType.QUOTATION) {
      activeWhere = {
        tenantId,
        type: MasterFileType.QUOTATION,
        isActive: true,
        customerCompanyId: null,
      };
    } else if (type === MasterFileType.DRIVER_PAYOUT) {
      activeWhere = {
        tenantId,
        type: MasterFileType.DRIVER_PAYOUT,
        isActive: true,
        customerCompanyId: null,
      };
    } else {
      activeWhere = {
        tenantId,
        type: MasterFileType.DHC_REFERENCE,
        status: MasterFileStatus.PARSED,
        isActive: true,
        customerCompanyId: null,
      };
    }

    const active = await this.prisma.masterFile.findFirst({
      where: activeWhere,
      orderBy: { uploadedAt: "desc" },
    });
    if (!active) return { masterFile: null, items: [] };
    if (type === MasterFileType.QUOTATION) {
      const items = await this.prisma.customerQuotationItem.findMany({
        where: { tenantId, masterFileId: active.id, active: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      });
      return { masterFile: active, items };
    }
    if (type === MasterFileType.DRIVER_PAYOUT) {
      const items = await this.prisma.driverPayoutItem.findMany({
        where: { tenantId, masterFileId: active.id, active: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      });
      return { masterFile: active, items };
    }
    const items = await this.prisma.dhcReferenceItem.findMany({
      where: { tenantId, masterFileId: active.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    return { masterFile: active, items };
  }

  async activateMasterFile(tenantId: string, id: string) {
    const target = await this.prisma.masterFile.findFirst({ where: { tenantId, id } });
    if (!target) throw new NotFoundException("Master file not found");
    if (
      target.type === MasterFileType.DHC_REFERENCE &&
      target.status === MasterFileStatus.PARSE_FAILED
    ) {
      throw new BadRequestException("Cannot activate a DHC reference file that has no parsed rows.");
    }
    if (target.type === MasterFileType.DHC_REFERENCE) {
      const parsedCount = await this.prisma.dhcReferenceItem.count({
        where: { tenantId, masterFileId: target.id, active: true },
      });
      if (parsedCount <= 0) {
        throw new BadRequestException("Cannot activate a DHC reference file that has no parsed rows.");
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.masterFile.updateMany({
        where: {
          tenantId,
          type: target.type,
          isActive: true,
          customerCompanyId: target.customerCompanyId ?? null,
          NOT: { id: target.id },
        },
        data: { isActive: false, status: MasterFileStatus.SUPERSEDED },
      });
      await tx.masterFile.update({
        where: { id: target.id },
        data: { isActive: true, status: target.status === MasterFileStatus.PARSE_FAILED ? MasterFileStatus.PARSE_FAILED : MasterFileStatus.PARSED },
      });
    });
    return this.prisma.masterFile.findUnique({ where: { id } });
  }

  async reprocessMasterFile(tenantId: string, id: string) {
    const masterFile = await this.prisma.masterFile.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        tenantId: true,
        customerCompanyId: true,
        type: true,
        fileName: true,
        fileUrl: true,
        parseSummaryJson: true,
        status: true,
      },
    });
    if (!masterFile) throw new NotFoundException("Master file not found");
    if (masterFile.type === MasterFileType.CUSTOMER_QUOTATION) {
      throw new BadRequestException(
        "Legacy CUSTOMER_QUOTATION reprocess is disabled. Use QUOTATION master files.",
      );
    }
    if (
      (masterFile.type === MasterFileType.DRIVER_PAYOUT ||
        masterFile.type === MasterFileType.DHC_REFERENCE) &&
      masterFile.customerCompanyId
    ) {
      throw new BadRequestException(
        `Invalid ${masterFile.type} scope: customerCompanyId must be null`,
      );
    }

    const buffer = await this.downloadMasterObject(masterFile.fileUrl);
    const file: Express.Multer.File = {
      fieldname: "file",
      originalname: masterFile.fileName,
      encoding: "7bit",
      mimetype: this.inferMimeFromFileName(masterFile.fileName),
      size: buffer.length,
      destination: "",
      filename: masterFile.fileName,
      path: "",
      buffer,
      stream: undefined as any,
    };

    let parsed:
      | { items: any[]; summary: Record<string, unknown>; status?: MasterFileStatus }
      | undefined;
    if (masterFile.type === MasterFileType.QUOTATION) {
      parsed = await this.parseQuotationItemsFromFile(file);
    } else if (masterFile.type === MasterFileType.DRIVER_PAYOUT) {
      parsed = this.parseDriverPayoutItems(buffer);
    } else {
      parsed = await this.parseDhcItems(file);
    }

    const finalStatus =
      parsed.status ??
      (parsed.items.length > 0
        ? MasterFileStatus.PARSED
        : MasterFileStatus.PARSE_FAILED);

    const existingSummary =
      (masterFile.parseSummaryJson as Record<string, unknown> | null) ?? {};
    const nowIso = new Date().toISOString();
    const nextSummary: Prisma.InputJsonValue = {
      ...existingSummary,
      ...parsed.summary,
      parserMeta: {
        reprocessedAt: nowIso,
        sourceStorageKey: masterFile.fileUrl,
        sourceFileName: masterFile.fileName,
        type: masterFile.type,
      },
    };

    const counts = await this.prisma.$transaction(async (tx) => {
      if (masterFile.type === MasterFileType.QUOTATION) {
        await tx.customerQuotationItem.deleteMany({
          where: { tenantId, masterFileId: masterFile.id },
        });
        if (parsed.items.length > 0) {
          await tx.customerQuotationItem.createMany({
            data: parsed.items.map((r) => ({
              tenantId,
              masterFileId: masterFile.id,
              ...r,
            })),
          });
        }
      } else if (masterFile.type === MasterFileType.DRIVER_PAYOUT) {
        await tx.driverPayoutItem.deleteMany({
          where: { tenantId, masterFileId: masterFile.id },
        });
        if (parsed.items.length > 0) {
          await tx.driverPayoutItem.createMany({
            data: parsed.items.map((r) => ({
              tenantId,
              masterFileId: masterFile.id,
              ...r,
            })),
          });
        }
      } else {
        await tx.dhcReferenceItem.deleteMany({
          where: { tenantId, masterFileId: masterFile.id },
        });
        if (parsed.items.length > 0) {
          await tx.dhcReferenceItem.createMany({
            data: parsed.items.map((r) => ({
              tenantId,
              masterFileId: masterFile.id,
              ...r,
            })),
          });
        }
      }

      await tx.masterFile.update({
        where: { id: masterFile.id },
        data: {
          status: finalStatus,
          parseSummaryJson: nextSummary,
        },
      });

      return {
        parsedItemCount: parsed.items.length,
      };
    });

    return {
      masterFileId: masterFile.id,
      type: masterFile.type,
      status: finalStatus,
      parsedItemCount: counts.parsedItemCount,
      parseSummaryJson: nextSummary,
      message: "Reprocess completed from stored source file",
    };
  }

  async replaceQuotationMasterFileItems(
    tenantId: string,
    id: string,
    items: Array<Record<string, any>>,
  ) {
    const masterFile = await this.prisma.masterFile.findFirst({
      where: { tenantId, id },
      select: { id: true, type: true, tenantId: true },
    });
    if (!masterFile) throw new NotFoundException("Master file not found");
    if (masterFile.type !== MasterFileType.QUOTATION) {
      throw new BadRequestException("Only QUOTATION master files support item save");
    }

    const normalized = (items ?? []).map((r, index) => ({
      tenantId,
      masterFileId: masterFile.id,
      section: r.section ?? null,
      code: String(r.code ?? "").trim(),
      label: String(r.label ?? "").trim(),
      description: r.description ?? null,
      category: r.category ?? null,
      containerSize: r.containerSize ?? null,
      tripMode: r.tripMode ?? null,
      areaScope: r.areaScope ?? null,
      unit: r.unit ?? null,
      rateCents:
        r.rateCents === null || r.rateCents === undefined
          ? null
          : Number.isInteger(Number(r.rateCents))
            ? Number(r.rateCents)
            : null,
      notes: r.notes ?? null,
      requiresManualAmount: !!r.requiresManualAmount,
      rawRateText: r.rawRateText ?? null,
      sortOrder: Number.isInteger(Number(r.sortOrder)) ? Number(r.sortOrder) : index,
      active: r.active !== false,
    }));

    for (const row of normalized) {
      if (!row.code || !row.label) {
        throw new BadRequestException("Each item requires non-empty code and label");
      }
      if (row.rateCents !== null && row.rateCents < 0) {
        throw new BadRequestException(`Invalid negative rateCents for item ${row.code}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerQuotationItem.deleteMany({
        where: { tenantId, masterFileId: masterFile.id },
      });
      if (normalized.length > 0) {
        await tx.customerQuotationItem.createMany({ data: normalized });
      }
      await tx.masterFile.update({
        where: { id: masterFile.id },
        data: {
          status:
            normalized.length > 0 ? MasterFileStatus.PARSED : MasterFileStatus.PARSE_FAILED,
          parseSummaryJson: {
            parserMeta: {
              source: "MANUAL_EDIT",
              updatedAt: new Date().toISOString(),
            },
            lineCount: normalized.length,
            note: "Quotation items updated via PATCH /master/files/:id/items",
          } as Prisma.InputJsonValue,
        },
      });
    });

    return this.getActiveMasterItems(tenantId, MasterFileType.QUOTATION, null);
  }

  private async createDatasetVersionWithRows(
    tenantId: string,
    type: MasterRateDatasetType,
    rows: Array<Record<string, any>>,
    actorUserId: string | null,
    sourceFileName: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.masterRateDataset.findFirst({
        where: { tenantId, type },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
      const versionNo = (latest?.versionNo ?? 0) + 1;

      // Clear current pointer on all prior versions for this tenant+type.
      await tx.masterRateDataset.updateMany({
        where: { tenantId, type, isCurrent: true },
        data: { isCurrent: false },
      });
      // Demote previous ACTIVE rows to DRAFT (historical versions stay readable).
      await tx.masterRateDataset.updateMany({
        where: { tenantId, type, status: MasterRateDatasetStatus.ACTIVE },
        data: { status: MasterRateDatasetStatus.DRAFT },
      });

      const dataset = await tx.masterRateDataset.create({
        data: {
          tenantId,
          type,
          versionNo,
          status: MasterRateDatasetStatus.ACTIVE,
          isCurrent: true,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          importedAt: new Date(),
          importedByUserId: actorUserId,
          sourceFileName,
          activatedAt: new Date(),
          activatedByUserId: actorUserId,
        },
      });

      if (rows.length > 0) {
        await tx.masterRateDatasetRow.createMany({
          data: rows.map((r, index) => ({
            tenantId,
            datasetId: dataset.id,
            code: r.code,
            label: r.label,
            section: r.section ?? null,
            description: r.description ?? null,
            category: r.category ?? null,
            unit: r.unit ?? null,
            containerSize: r.containerSize ?? null,
            tripMode: r.tripMode ?? null,
            areaScope: r.areaScope ?? null,
            currency: r.currency ?? "SGD",
            rateCents: r.rateCents ?? r.amountCents ?? null,
            rawRateText: r.rawRateText ?? null,
            requiresManualAmount: !!r.requiresManualAmount,
            hasMultipleRates: !!r.hasMultipleRates,
            rateOptionsJson: (r.rateOptionsJson ?? null) as Prisma.InputJsonValue,
            defaultRateOptionIndex: r.defaultRateOptionIndex ?? null,
            notes: r.notes ?? null,
            sortOrder: Number.isInteger(r.sortOrder) ? r.sortOrder : index,
            isActive: r.isActive !== false,
            metadataJson: (r.metadataJson ?? null) as Prisma.InputJsonValue,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          })),
        });
      }

      return dataset;
    });
  }

  private async listDatasetRows(tenantId: string, type: MasterRateDatasetType) {
    const dataset = await this.findPreferredDataset(tenantId, type);
    if (!dataset) return [];
    return this.prisma.masterRateDatasetRow.findMany({
      where: { tenantId, datasetId: dataset.id },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
    });
  }

  private async findPreferredDataset(tenantId: string, type: MasterRateDatasetType) {
    return (
      (await this.prisma.masterRateDataset.findFirst({
        where: { tenantId, type, isCurrent: true },
        orderBy: { versionNo: "desc" },
      })) ??
      (await this.prisma.masterRateDataset.findFirst({
        where: { tenantId, type, status: MasterRateDatasetStatus.ACTIVE },
        orderBy: { versionNo: "desc" },
      })) ??
      (await this.prisma.masterRateDataset.findFirst({
        where: { tenantId, type },
        orderBy: { versionNo: "desc" },
      }))
    );
  }

  private templateTypeLabel(type: MasterRateDatasetType): string {
    switch (type) {
      case MasterRateDatasetType.QUOTATION:
        return "base quotation template";
      case MasterRateDatasetType.DHC_RATES:
        return "DHC rates template";
      case MasterRateDatasetType.TRUCKING_RATES:
        return "driver payout (trucking) template";
      default:
        return "rate template";
    }
  }

  private assertExpectedVersionNo(
    currentVersionNo: number,
    expectedVersionNo?: number | null,
    type: MasterRateDatasetType = MasterRateDatasetType.QUOTATION,
  ) {
    if (
      expectedVersionNo != null &&
      Number(expectedVersionNo) !== currentVersionNo
    ) {
      throw new ConflictException(
        `The ${this.templateTypeLabel(type)} was updated by someone else (version ${currentVersionNo}). Reload and try again.`,
      );
    }
  }

  private countQuotationSections(rows: Array<Record<string, any>>): number {
    const sections = new Set<string>();
    for (const r of rows) {
      const meta =
        r.metadataJson && typeof r.metadataJson === "object"
          ? (r.metadataJson as Record<string, unknown>)
          : null;
      const annex = meta?.annex != null ? String(meta.annex).trim() : "";
      const section =
        r.section != null && String(r.section).trim()
          ? String(r.section).trim()
          : meta?.sectionDisplay != null
            ? String(meta.sectionDisplay).trim()
            : "";
      const key = annex || section;
      if (key) sections.add(key);
    }
    return sections.size;
  }

  private normalizeQuotationImportLines(
    lines: ReturnType<typeof parseQuotationRateLinesFromXlsxBuffer>,
    tenantId: string,
  ) {
    return lines.map((l, index) => ({
      tenantId,
      section: l.section ?? null,
      code: l.code,
      label: l.label,
      description: l.description ?? null,
      category: l.category ?? null,
      containerSize: l.containerSize ?? null,
      tripMode: l.tripMode ?? null,
      areaScope: l.areaScope ?? null,
      unit: l.unit ?? null,
      rateCents: l.rateCents ?? null,
      requiresManualAmount: !!l.requiresManualAmount,
      rawRateText: l.rawRateText ?? null,
      notes: l.notes ?? null,
      sortOrder: Number.isInteger(l.sortOrder) ? l.sortOrder : index,
      active: true,
      isActive: true,
      sourceType: l.sourceType ?? "EXCEL_IMPORT",
      metadataJson: {
        ...(l.metadataJson ?? {}),
        annex: l.annex ?? (l.metadataJson as any)?.annex ?? null,
        sectionCode: l.sectionCode ?? (l.metadataJson as any)?.sectionCode ?? null,
        groupTitle: l.groupTitle ?? (l.metadataJson as any)?.groupTitle ?? null,
        sectionDisplay: l.sectionDisplay ?? (l.metadataJson as any)?.sectionDisplay ?? null,
        baseCode: l.baseCode ?? (l.metadataJson as any)?.baseCode ?? null,
        baseLabel: l.baseLabel ?? (l.metadataJson as any)?.baseLabel ?? null,
        variantType: l.variantType ?? (l.metadataJson as any)?.variantType ?? null,
        variantLabel: l.variantLabel ?? (l.metadataJson as any)?.variantLabel ?? null,
        containerSize: l.containerSize ?? (l.metadataJson as any)?.containerSize ?? null,
        equipmentType: l.equipmentType ?? (l.metadataJson as any)?.equipmentType ?? null,
        areaScope: l.areaScope ?? (l.metadataJson as any)?.areaScope ?? null,
        itemNo: l.itemNo ?? (l.metadataJson as any)?.itemNo ?? null,
        additionalRuleText:
          l.additionalRuleText ?? (l.metadataJson as any)?.additionalRuleText ?? null,
        rawValueText: l.rawRateText ?? (l.metadataJson as any)?.rawValueText ?? null,
        parserSourceType: (l.metadataJson as any)?.parserSourceType ?? "PARSER_ANNEX_MATRIX",
      } as Prisma.InputJsonValue,
    }));
  }

  private parseQuotationExcelOrThrow(file: Express.Multer.File) {
    const name = String(file?.originalname ?? "").toLowerCase();
    const isExcel = /\.xlsx?$/i.test(name);
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    if (!isExcel) {
      throw new BadRequestException("Quotation import must be Excel (.xlsx/.xls)");
    }
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
    return { lines, reconciliation };
  }

  private rowRateCents(row: Record<string, any>): number | null {
    const value = row.rateCents ?? row.amountCents ?? null;
    return value == null ? null : Number(value);
  }

  private diffTemplateRows(
    currentRows: Array<Record<string, any>>,
    nextRows: Array<Record<string, any>>,
  ) {
    const currentByCode = new Map(
      currentRows.map((r) => [String(r.code ?? "").trim(), r]),
    );
    const nextByCode = new Map(
      nextRows.map((r) => [String(r.code ?? "").trim(), r]),
    );
    const added: Array<{ code: string; label: string }> = [];
    const removed: Array<{ code: string; label: string }> = [];
    const changed: Array<{ code: string; label: string; changes: string[] }> = [];

    for (const [code, next] of nextByCode) {
      if (!code) continue;
      const prev = currentByCode.get(code);
      if (!prev) {
        added.push({ code, label: String(next.label ?? "") });
        continue;
      }
      const changes: string[] = [];
      if (String(prev.label ?? "") !== String(next.label ?? "")) changes.push("label");
      if (this.rowRateCents(prev) !== this.rowRateCents(next)) changes.push("rate");
      if (String(prev.rawRateText ?? "") !== String(next.rawRateText ?? "")) {
        changes.push("rawRateText");
      }
      if (String(prev.notes ?? "") !== String(next.notes ?? "")) changes.push("notes");
      const prevMeta = JSON.stringify(prev.metadataJson ?? null);
      const nextMeta = JSON.stringify(next.metadataJson ?? null);
      if (prevMeta !== nextMeta) changes.push("metadata");
      if (String(prev.section ?? "") !== String(next.section ?? "")) {
        changes.push("section");
      }
      if (changes.length > 0) {
        changed.push({ code, label: String(next.label ?? prev.label ?? ""), changes });
      }
    }
    for (const [code, prev] of currentByCode) {
      if (!code) continue;
      if (!nextByCode.has(code)) {
        removed.push({ code, label: String(prev.label ?? "") });
      }
    }
    return { added, removed, changed };
  }

  /** @deprecated Use diffTemplateRows */
  private diffQuotationTemplateRows(
    currentRows: Array<Record<string, any>>,
    nextRows: Array<Record<string, any>>,
  ) {
    return this.diffTemplateRows(currentRows, nextRows);
  }

  async listTemplateVersions(tenantId: string, type: MasterRateDatasetType) {
    const datasets = await this.prisma.masterRateDataset.findMany({
      where: { tenantId, type },
      orderBy: { versionNo: "desc" },
      select: {
        id: true,
        versionNo: true,
        isCurrent: true,
        status: true,
        sourceFileName: true,
        updatedAt: true,
        updatedByUserId: true,
        importedAt: true,
        _count: { select: { rows: true } },
      },
    });
    return datasets.map((d) => ({
      id: d.id,
      versionNo: d.versionNo,
      isCurrent: d.isCurrent,
      status: d.status,
      sourceFileName: d.sourceFileName,
      updatedAt: d.updatedAt,
      updatedByUserId: d.updatedByUserId,
      importedAt: d.importedAt,
      rowCount: d._count.rows,
    }));
  }

  async restoreTemplateVersion(
    tenantId: string,
    type: MasterRateDatasetType,
    datasetId: string,
    actorUserId: string | null = null,
    expectedVersionNo?: number | null,
  ) {
    const historical = await this.prisma.masterRateDataset.findFirst({
      where: { id: datasetId, tenantId, type },
      include: {
        rows: {
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!historical) {
      throw new NotFoundException(
        `${this.templateTypeLabel(type)} version not found`,
      );
    }

    const current = await this.findPreferredDataset(tenantId, type);
    if (current) {
      this.assertExpectedVersionNo(current.versionNo, expectedVersionNo, type);
    }
    if (historical.isCurrent && current?.id === historical.id) {
      throw new BadRequestException(
        `Selected version is already the current ${this.templateTypeLabel(type)}.`,
      );
    }

    const copiedRows = historical.rows.map((r, index) => ({
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
      rateOptionsJson: r.rateOptionsJson,
      defaultRateOptionIndex: r.defaultRateOptionIndex,
      notes: r.notes,
      sortOrder: Number.isInteger(r.sortOrder) ? r.sortOrder : index,
      isActive: r.isActive !== false,
      metadataJson: r.metadataJson,
    }));

    const sourceFileName = historical.sourceFileName?.trim()
      ? `${historical.sourceFileName} (restored from v${historical.versionNo})`
      : `Restored from v${historical.versionNo}`;

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      type,
      copiedRows,
      actorUserId,
      sourceFileName,
    );

    const restoreAction =
      type === MasterRateDatasetType.QUOTATION
        ? "RESTORE_BASE_QUOTATION_TEMPLATE"
        : type === MasterRateDatasetType.DHC_RATES
          ? "RESTORE_DHC_RATES_TEMPLATE"
          : "RESTORE_TRUCKING_RATES_TEMPLATE";

    await this.audit.log(
      tenantId,
      "CREATE",
      "MasterRateDataset",
      dataset.id,
      {
        action: restoreAction,
        restoredFromDatasetId: historical.id,
        restoredFromVersionNo: historical.versionNo,
        fromVersionNo: current?.versionNo ?? null,
        toVersionNo: dataset.versionNo,
        previousDatasetId: current?.id ?? null,
        newDatasetId: dataset.id,
        rowCount: copiedRows.length,
        type,
      },
      actorUserId,
    );

    const items =
      type === MasterRateDatasetType.QUOTATION
        ? await this.listQuotationDatasetItems(tenantId)
        : type === MasterRateDatasetType.DHC_RATES
          ? await this.listDhcRateDatasetItems(tenantId)
          : await this.listDriverTripRateMasters(tenantId);

    return {
      items,
      dataset: {
        id: dataset.id,
        versionNo: dataset.versionNo,
        isCurrent: true,
        restoredFromDatasetId: historical.id,
        restoredFromVersionNo: historical.versionNo,
      },
    };
  }

  async exportCurrentTemplate(tenantId: string, type: MasterRateDatasetType) {
    const current = await this.findPreferredDataset(tenantId, type);
    if (!current) {
      throw new BadRequestException(
        `No ${this.templateTypeLabel(type)} configured. Import Excel or create a blank template first.`,
      );
    }
    const items =
      type === MasterRateDatasetType.QUOTATION
        ? await this.listQuotationDatasetItems(tenantId)
        : type === MasterRateDatasetType.DHC_RATES
          ? await this.listDhcRateDatasetItems(tenantId)
          : await this.listDriverTripRateMasters(tenantId);
    return {
      versionNo: current.versionNo,
      sourceFileName: current.sourceFileName ?? null,
      exportedAt: new Date().toISOString(),
      items,
    };
  }

  async createBlankTemplate(
    tenantId: string,
    type: MasterRateDatasetType,
    actorUserId: string | null = null,
  ) {
    const existing = await this.findPreferredDataset(tenantId, type);
    if (existing) {
      throw new BadRequestException(
        `A ${this.templateTypeLabel(type)} already exists. Edit and save it, or import/replace from Excel.`,
      );
    }

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      type,
      [],
      actorUserId,
      null,
    );

    const blankAction =
      type === MasterRateDatasetType.QUOTATION
        ? "CREATE_BLANK_BASE_QUOTATION_TEMPLATE"
        : type === MasterRateDatasetType.DHC_RATES
          ? "CREATE_BLANK_DHC_RATES_TEMPLATE"
          : "CREATE_BLANK_TRUCKING_RATES_TEMPLATE";

    await this.audit.log(
      tenantId,
      "CREATE",
      "MasterRateDataset",
      dataset.id,
      { action: blankAction, versionNo: dataset.versionNo, type },
      actorUserId,
    );

    return this.getDatasetMetadata(tenantId, type);
  }

  async getDatasetMetadata(tenantId: string, type: MasterRateDatasetType) {
    const dataset = await this.findPreferredDataset(tenantId, type);
    if (!dataset) return { dataset: null };
    const userIds = [
      dataset.importedByUserId,
      dataset.updatedByUserId,
      dataset.activatedByUserId,
    ].filter((id): id is string => !!id);
    type UserLite = { id: string; name: string | null; email: string };
    const users: UserLite[] =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: [...new Set(userIds)] } },
            select: { id: true, name: true, email: true },
          })
        : [];
    const byId = new Map<string, UserLite>(users.map((u) => [u.id, u]));
    const importedBy = dataset.importedByUserId
      ? byId.get(dataset.importedByUserId) ?? null
      : null;
    const updatedBy = dataset.updatedByUserId
      ? byId.get(dataset.updatedByUserId) ?? null
      : null;
    const rows = await this.prisma.masterRateDatasetRow.findMany({
      where: { tenantId, datasetId: dataset.id },
      select: { section: true, metadataJson: true },
    });
    return {
      dataset: {
        id: dataset.id,
        tenantId: dataset.tenantId,
        type: dataset.type,
        versionNo: dataset.versionNo,
        status: dataset.status,
        isCurrent: dataset.isCurrent,
        importedAt: dataset.importedAt,
        importedByUserId: dataset.importedByUserId,
        importedByName: importedBy?.name ?? null,
        importedByEmail: importedBy?.email ?? null,
        sourceFileName: dataset.sourceFileName ?? null,
        activatedAt: dataset.activatedAt,
        activatedByUserId: dataset.activatedByUserId,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt,
        updatedByUserId: dataset.updatedByUserId,
        updatedByName: updatedBy?.name ?? null,
        updatedByEmail: updatedBy?.email ?? null,
        rowCount: rows.length,
        sectionCount: this.countQuotationSections(rows),
      },
    };
  }

  private async replaceDatasetRows(
    tenantId: string,
    type: MasterRateDatasetType,
    rows: Array<Record<string, any>>,
    actorUserId: string | null,
  ) {
    const dataset = await this.prisma.masterRateDataset.findFirst({
      where: { tenantId, type, status: MasterRateDatasetStatus.ACTIVE },
      orderBy: { versionNo: "desc" },
      select: { id: true },
    });
    if (!dataset) {
      throw new BadRequestException(`No active ${type} dataset found. Import first.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.masterRateDatasetRow.deleteMany({
        where: { tenantId, datasetId: dataset.id },
      });
      if (rows.length > 0) {
        await tx.masterRateDatasetRow.createMany({
          data: rows.map((r, index) => ({
            tenantId,
            datasetId: dataset.id,
            code: r.code,
            label: r.label,
            section: r.section ?? null,
            description: r.description ?? null,
            category: r.category ?? null,
            unit: r.unit ?? null,
            containerSize: r.containerSize ?? null,
            tripMode: r.tripMode ?? null,
            areaScope: r.areaScope ?? null,
            currency: r.currency ?? "SGD",
            rateCents: r.rateCents ?? r.amountCents ?? null,
            rawRateText: r.rawRateText ?? null,
            requiresManualAmount: !!r.requiresManualAmount,
            hasMultipleRates: !!r.hasMultipleRates,
            rateOptionsJson: (r.rateOptionsJson ?? null) as Prisma.InputJsonValue,
            defaultRateOptionIndex: r.defaultRateOptionIndex ?? null,
            notes: r.notes ?? null,
            sortOrder: Number.isInteger(r.sortOrder) ? r.sortOrder : index,
            isActive: r.isActive !== false,
            metadataJson: (r.metadataJson ?? null) as Prisma.InputJsonValue,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          })),
        });
      }
      await tx.masterRateDataset.update({
        where: { id: dataset.id },
        data: { updatedByUserId: actorUserId, activatedByUserId: actorUserId, activatedAt: new Date() },
      });
    });
  }

  async previewQuotationImport(tenantId: string, file: Express.Multer.File) {
    const { lines, reconciliation } = this.parseQuotationExcelOrThrow(file);
    const normalized = this.normalizeQuotationImportLines(lines, tenantId);
    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.QUOTATION,
    );
    const currentRows = current
      ? await this.prisma.masterRateDatasetRow.findMany({
          where: { tenantId, datasetId: current.id },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
        })
      : [];
    const diff = this.diffTemplateRows(currentRows, normalized);
    return {
      currentVersionNo: current?.versionNo ?? null,
      currentSourceFileName: current?.sourceFileName ?? null,
      uploadedFileName: file.originalname ?? "quotation-import.xlsx",
      sectionCount: this.countQuotationSections(normalized),
      lineCount: normalized.length,
      warnings: reconciliation.warnings ?? [],
      reconciliation,
      diff,
      items: normalized,
    };
  }

  async importQuotationDataset(
    tenantId: string,
    file: Express.Multer.File,
    actorUserId: string | null = null,
    opts?: { confirmReplace?: boolean; expectedVersionNo?: number | null },
  ): Promise<{ importedCount: number; items: any[]; summary: Record<string, unknown> }> {
    // Parse/validate before any DB or storage write so failures never leave partial current.
    const { lines, reconciliation } = this.parseQuotationExcelOrThrow(file);
    const normalized = this.normalizeQuotationImportLines(lines, tenantId);

    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.QUOTATION,
    );
    if (current && opts?.confirmReplace !== true) {
      throw new BadRequestException(
        "A current base quotation template already exists. Preview the import and confirm replace to proceed.",
      );
    }
    if (current) {
      this.assertExpectedVersionNo(
        current.versionNo,
        opts?.expectedVersionNo,
        MasterRateDatasetType.QUOTATION,
      );
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".bin";
    const storageKey = `${tenantId}/masters/quotation/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${ext}`;
    await this.uploadMasterObject(
      storageKey,
      file.buffer,
      file.mimetype ?? "application/octet-stream",
    );

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      MasterRateDatasetType.QUOTATION,
      normalized.map((r, i) => ({
        ...r,
        isActive: true,
        sortOrder: r.sortOrder ?? i,
      })),
      actorUserId,
      file.originalname ?? null,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.masterFile.updateMany({
        where: {
          tenantId,
          type: MasterFileType.QUOTATION,
          isActive: true,
          customerCompanyId: null,
        },
        data: { isActive: false, status: MasterFileStatus.SUPERSEDED },
      });
      await tx.masterFile.create({
        data: {
          tenantId,
          customerCompanyId: null,
          type: MasterFileType.QUOTATION,
          fileName: file.originalname ?? "quotation-import.xlsx",
          fileUrl: storageKey,
          uploadedByUserId: actorUserId,
          uploadedAt: new Date(),
          effectiveDate: null,
          status: MasterFileStatus.PARSED,
          parseSummaryJson: {
            source: "DATASET_IMPORT_AUDIT",
            datasetType: "QUOTATION",
            datasetId: dataset.id,
            versionNo: dataset.versionNo,
            lineCount: normalized.length,
            previousDatasetId: current?.id ?? null,
            previousVersionNo: current?.versionNo ?? null,
          } as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    });

    return {
      importedCount: normalized.length,
      items: await this.listQuotationDatasetItems(tenantId),
      summary: {
        datasetId: dataset.id,
        versionNo: dataset.versionNo,
        isCurrent: true,
        sourceFileStorageKey: storageKey,
        lineCount: normalized.length,
        reconciliation,
        note: "Quotation dataset imported from Excel (source file stored for audit only).",
      },
    };
  }

  async listQuotationDatasetItems(tenantId: string) {
    return this.listDatasetRows(tenantId, MasterRateDatasetType.QUOTATION).then((rows) =>
      rows.map((r: any) => {
        const meta =
          r.metadataJson && typeof r.metadataJson === "object"
            ? (r.metadataJson as Record<string, unknown>)
            : null;
        const rate20ftCents =
          typeof meta?.rate20ftCents === "number" ? meta.rate20ftCents : null;
        const rate40ftCents =
          typeof meta?.rate40ftCents === "number" ? meta.rate40ftCents : null;
        return {
          ...r,
          active: r.isActive,
          rate20ftCents,
          rate40ftCents,
        };
      }),
    );
  }

  async listQuotationTemplateVersions(tenantId: string) {
    return this.listTemplateVersions(tenantId, MasterRateDatasetType.QUOTATION);
  }

  async restoreQuotationTemplateVersion(
    tenantId: string,
    datasetId: string,
    actorUserId: string | null = null,
    expectedVersionNo?: number | null,
  ) {
    return this.restoreTemplateVersion(
      tenantId,
      MasterRateDatasetType.QUOTATION,
      datasetId,
      actorUserId,
      expectedVersionNo,
    );
  }

  async exportCurrentQuotationTemplate(tenantId: string) {
    return this.exportCurrentTemplate(tenantId, MasterRateDatasetType.QUOTATION);
  }

  /**
   * Save base quotation template:
   * - preserves metadataJson (annex/variant/rules/20'+40')
   * - optimistic concurrency via expectedVersionNo
   * - creates a NEW current dataset version (does not mutate prior version rows)
   */
  async replaceQuotationDatasetItems(
    tenantId: string,
    items: Array<Record<string, any>>,
    actorUserId: string | null = null,
    expectedVersionNo?: number | null,
  ) {
    const normalized = (items ?? []).map((r, index) => {
      const baseMeta =
        r.metadataJson && typeof r.metadataJson === "object"
          ? { ...(r.metadataJson as Record<string, unknown>) }
          : {};
      if (r.rate20ftCents !== undefined) {
        baseMeta.rate20ftCents =
          r.rate20ftCents === null || r.rate20ftCents === undefined
            ? null
            : Number(r.rate20ftCents);
      }
      if (r.rate40ftCents !== undefined) {
        baseMeta.rate40ftCents =
          r.rate40ftCents === null || r.rate40ftCents === undefined
            ? null
            : Number(r.rate40ftCents);
      }
      const rateCents =
        r.rateCents === null || r.rateCents === undefined
          ? null
          : Number.isInteger(Number(r.rateCents))
            ? Number(r.rateCents)
            : null;
      const rawRateText =
        r.rawRateText == null ? null : String(r.rawRateText).trim() || null;
      return {
        tenantId,
        section: r.section ?? null,
        code: String(r.code ?? "").trim(),
        label: String(r.label ?? "").trim(),
        description: r.description ?? null,
        category: r.category ?? null,
        containerSize: r.containerSize ?? null,
        tripMode: r.tripMode ?? null,
        areaScope: r.areaScope ?? null,
        unit: r.unit ?? null,
        rateCents,
        requiresManualAmount:
          r.requiresManualAmount === true ||
          (rateCents == null && !rawRateText),
        rawRateText,
        notes: r.notes ?? null,
        sortOrder: Number.isInteger(Number(r.sortOrder))
          ? Number(r.sortOrder)
          : index,
        isActive: r.active !== false,
        sourceType: "MANUAL_EDIT",
        metadataJson: Object.keys(baseMeta).length > 0 ? baseMeta : null,
      };
    });

    for (const row of normalized) {
      if (!row.code || !row.label) {
        throw new BadRequestException("Each item requires non-empty code and label");
      }
      if (row.rateCents !== null && row.rateCents < 0) {
        throw new BadRequestException(`Invalid negative rateCents for item ${row.code}`);
      }
    }

    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.QUOTATION,
    );
    if (!current) {
      throw new BadRequestException(
        "No base quotation template configured. Import Excel or create a blank template first.",
      );
    }
    this.assertExpectedVersionNo(
      current.versionNo,
      expectedVersionNo,
      MasterRateDatasetType.QUOTATION,
    );

    const previousRows = await this.prisma.masterRateDatasetRow.findMany({
      where: { tenantId, datasetId: current.id },
      select: { code: true, label: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      MasterRateDatasetType.QUOTATION,
      normalized,
      actorUserId,
      current.sourceFileName ?? null,
    );

    await this.audit.log(
      tenantId,
      "UPDATE",
      "MasterRateDataset",
      dataset.id,
      {
        action: "SAVE_BASE_QUOTATION_TEMPLATE",
        fromVersionNo: current.versionNo,
        toVersionNo: dataset.versionNo,
        previousDatasetId: current.id,
        newDatasetId: dataset.id,
        previousRowCount: previousRows.length,
        nextRowCount: normalized.length,
        addedCodes: normalized
          .map((r) => r.code)
          .filter((code) => !previousRows.some((p) => p.code === code)),
        removedCodes: previousRows
          .map((r) => r.code)
          .filter((code) => !normalized.some((n) => n.code === code)),
      },
      actorUserId,
    );

    return {
      items: await this.listQuotationDatasetItems(tenantId),
      dataset: {
        id: dataset.id,
        versionNo: dataset.versionNo,
        isCurrent: true,
      },
    };
  }

  /** Create an empty current base quotation template when none exists. */
  async createBlankQuotationTemplate(
    tenantId: string,
    actorUserId: string | null = null,
  ) {
    return this.createBlankTemplate(
      tenantId,
      MasterRateDatasetType.QUOTATION,
      actorUserId,
    );
  }

  listDriverTripRateMasters(tenantId: string) {
    return this.listDatasetRows(tenantId, MasterRateDatasetType.TRUCKING_RATES).then((rows) =>
      rows.map((r: any) => {
        const meta =
          r.metadataJson && typeof r.metadataJson === "object"
            ? (r.metadataJson as Record<string, unknown>)
            : {};
        return {
          ...r,
          active: r.isActive,
          amountCents: r.rateCents ?? null,
          section: r.section ?? meta.section ?? null,
          category: r.category ?? meta.category ?? null,
          uom: meta.uom ?? null,
          notes: r.notes ?? meta.notes ?? null,
        };
      }),
    );
  }

  private parseTruckingRateOptions(raw: unknown): {
    amountCents: number | null;
    rawRateText: string | null;
    requiresManualAmount: boolean;
    hasMultipleRates: boolean;
    rateOptionsJson: Array<{ label: string; amountCents: number | null }> | null;
    defaultRateOptionIndex: number | null;
  } {
    const text = String(raw ?? "").trim();
    if (!text) {
      return {
        amountCents: null,
        rawRateText: null,
        requiresManualAmount: true,
        hasMultipleRates: false,
        rateOptionsJson: null,
        defaultRateOptionIndex: null,
      };
    }
    const matches =
      text.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g)?.map((m) => m.trim()) ?? [];
    const parsedOptions = matches.map((m, idx) => ({
      label: `Option ${idx + 1}`,
      amountCents: this.parseMoney(m),
    }));

    if (parsedOptions.length === 1) {
      return {
        amountCents: parsedOptions[0].amountCents ?? null,
        rawRateText: null,
        requiresManualAmount: false,
        hasMultipleRates: false,
        rateOptionsJson: null,
        defaultRateOptionIndex: null,
      };
    }
    if (parsedOptions.length >= 2) {
      return {
        amountCents: null,
        rawRateText: text,
        requiresManualAmount: false,
        hasMultipleRates: true,
        rateOptionsJson: parsedOptions,
        defaultRateOptionIndex: null,
      };
    }

    return {
      amountCents: null,
      rawRateText: text,
      requiresManualAmount: true,
      hasMultipleRates: false,
      rateOptionsJson: null,
      defaultRateOptionIndex: null,
    };
  }

  async createDriverTripRateMaster(
    tenantId: string,
    dto: CreateDriverTripRateMasterDto,
  ) {
    const code = dto.code.trim();
    const label = dto.label.trim();
    const existing = await this.prisma.driverTripRateMaster.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(`Driver trip rate code already exists: ${code}`);
    }
    return this.prisma.driverTripRateMaster.create({
      data: {
        tenantId,
        code,
        label,
        amountCents: dto.amountCents ?? null,
        currency: dto.currency?.trim() || "SGD",
        active: dto.active ?? true,
        requiresManualAmount: dto.amountCents == null,
        hasMultipleRates: false,
        rawRateText: null,
        rateOptionsJson: null,
        defaultRateOptionIndex: null,
      },
    });
  }

  async updateDriverTripRateMaster(
    tenantId: string,
    id: string,
    dto: UpdateDriverTripRateMasterDto,
  ) {
    const existing = await this.prisma.driverTripRateMaster.findFirst({
      where: { tenantId, id },
      select: { id: true, code: true },
    });
    if (!existing) {
      throw new NotFoundException("Driver trip rate master not found");
    }

    const nextCode = dto.code?.trim();
    if (nextCode && nextCode !== existing.code) {
      const codeClash = await this.prisma.driverTripRateMaster.findFirst({
        where: { tenantId, code: nextCode, NOT: { id } },
        select: { id: true },
      });
      if (codeClash) {
        throw new BadRequestException(`Driver trip rate code already exists: ${nextCode}`);
      }
    }

    return this.prisma.driverTripRateMaster.update({
      where: { id },
      data: {
        ...(nextCode !== undefined ? { code: nextCode } : {}),
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.amountCents !== undefined ? { amountCents: dto.amountCents } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency.trim() || "SGD" } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.amountCents !== undefined
          ? {
              requiresManualAmount: dto.amountCents == null,
              hasMultipleRates: false,
              rawRateText: null,
              rateOptionsJson: null,
              defaultRateOptionIndex: null,
            }
          : {}),
      },
    });
  }

  async deactivateDriverTripRateMaster(tenantId: string, id: string) {
    const existing = await this.prisma.driverTripRateMaster.findFirst({
      where: { tenantId, id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Driver trip rate master not found");
    }
    return this.prisma.driverTripRateMaster.update({
      where: { id },
      data: { active: false },
    });
  }

  async importDriverTripRateMastersFromExcel(
    tenantId: string,
    buffer: Buffer,
  ): Promise<DriverTripRateImportSummaryDto> {
    let XLSX: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      XLSX = require("xlsx");
    } catch {
      throw new BadRequestException("Excel import requires xlsx package");
    }

    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return { createdCount: 0, updatedCount: 0, skippedCount: 0, errors: [], items: [] };
    }

    const sheet = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) {
      return { createdCount: 0, updatedCount: 0, skippedCount: 0, errors: [], items: [] };
    }

    const parsedRows: any[] = [];
    let headerRowIndex = rows.findIndex((r: any[]) => {
      const normalized = (r ?? []).map((c: any) => String(c).trim().toLowerCase());
      return (
        normalized.includes("code") &&
        normalized.includes("label") &&
        (normalized.includes("amountcents") ||
          normalized.includes("amount") ||
          normalized.includes("rate"))
      );
    });

    // Fallback parser for sectioned template:
    // [A, DESCRIPTION..., UOM, Rates]
    // [1, "Normal full trip", "Per Trip", 18]
    if (headerRowIndex < 0) {
      let currentSection = "";
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row) || row.every((c) => String(c ?? "").trim() === "")) continue;
        const c0 = String(row[0] ?? "").trim();
        const c1 = String(row[1] ?? "").trim();
        const c2 = String(row[2] ?? "").trim();
        const c3 = row[3];

        if (/^[A-Z]$/.test(c0) && /description/i.test(c1)) {
          currentSection = c0;
          continue;
        }

        const itemNo = String(row[0] ?? "").trim();
        const looksLikeItemNo = /^\d+$/.test(itemNo);
        if (!looksLikeItemNo) continue;
        const label = c1;
        if (!label) continue;
        const parsedRate = this.parseTruckingRateOptions(c3);
        parsedRows.push({
          code: currentSection ? `${currentSection}-${itemNo}` : itemNo,
          label,
          section: currentSection || null,
          unit: c2 || null,
          amountCents: parsedRate.amountCents,
          currency: "SGD",
          isActive: true,
          rawRateText: parsedRate.rawRateText,
          requiresManualAmount: parsedRate.requiresManualAmount,
          hasMultipleRates: parsedRate.hasMultipleRates,
          rateOptionsJson: parsedRate.rateOptionsJson,
          defaultRateOptionIndex: parsedRate.defaultRateOptionIndex,
          notes: null,
          metadataJson: null,
          sortOrder: parsedRows.length,
        });
      }
      if (!parsedRows.length) {
        throw new BadRequestException(
          "Excel must contain either standard headers (code/label/amount) or sectioned trucking template rows.",
        );
      }
    }

    const header = headerRowIndex >= 0
      ? rows[headerRowIndex].map((c: any) => String(c).trim().toLowerCase())
      : [];
    const idxCode = header.findIndex((h: string) => h === "code");
    const idxLabel = header.findIndex((h: string) => h === "label");
    const idxAmountCents = header.findIndex((h: string) => h === "amountcents");
    const idxAmount = header.findIndex((h: string) => h === "amount");
    const idxRate = header.findIndex((h: string) => h === "rate");
    const idxCurrency = header.findIndex((h: string) => h === "currency");
    const idxActive = header.findIndex((h: string) => h === "active");

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ rowNumber: number; reason: string }> = [];
    for (let i = headerRowIndex + 1; i < rows.length && headerRowIndex >= 0; i++) {
      const row = rows[i];
      const rowNumber = i + 1;
      if (!Array.isArray(row) || row.every((c) => String(c ?? "").trim() === "")) {
        continue;
      }

      const code = String(row[idxCode] ?? "").trim();
      const label = String(row[idxLabel] ?? "").trim();
      const rawAmount =
        idxAmountCents >= 0 ? row[idxAmountCents] : idxAmount >= 0 ? row[idxAmount] : row[idxRate];
      const parsedRate = this.parseTruckingRateOptions(rawAmount);
      const currency =
        idxCurrency >= 0 ? String(row[idxCurrency] ?? "").trim() || "SGD" : "SGD";
      const activeRaw = idxActive >= 0 ? String(row[idxActive] ?? "").trim().toLowerCase() : "";
      const active =
        idxActive < 0
          ? true
          : ["1", "true", "yes", "y", "active"].includes(activeRaw)
            ? true
            : ["0", "false", "no", "n", "inactive"].includes(activeRaw)
              ? false
              : true;

      if (!code) {
        skippedCount += 1;
        errors.push({ rowNumber, reason: "code is required" });
        continue;
      }
      if (!label) {
        skippedCount += 1;
        errors.push({ rowNumber, reason: `label is required for code ${code}` });
        continue;
      }
      if (
        parsedRate.amountCents != null &&
        (!Number.isInteger(parsedRate.amountCents) || parsedRate.amountCents < 0)
      ) {
        skippedCount += 1;
        errors.push({ rowNumber, reason: `amount is invalid for code ${code}` });
        continue;
      }

      createdCount += 1;
      const _row = {
        code,
        label,
        amountCents: parsedRate.amountCents,
        currency,
        isActive: active,
        rawRateText: parsedRate.rawRateText,
        requiresManualAmount: parsedRate.requiresManualAmount,
        hasMultipleRates: parsedRate.hasMultipleRates,
        rateOptionsJson: parsedRate.rateOptionsJson,
        defaultRateOptionIndex: parsedRate.defaultRateOptionIndex,
        notes: null,
        metadataJson: null,
        sortOrder: createdCount - 1,
      };
      parsedRows.push(_row);
    }
    const items = parsedRows.map((r) => ({
      ...r,
      active: r.isActive,
    }));
    return { createdCount, updatedCount, skippedCount, errors, items: items as any };
  }

  private async parseTruckingExcelOrThrow(file: Express.Multer.File) {
    const name = String(file?.originalname ?? "").toLowerCase();
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    if (!/\.xlsx?$/i.test(name)) {
      throw new BadRequestException("Trucking rates import must be Excel (.xlsx/.xls)");
    }
    return this.importDriverTripRateMastersFromExcel("parse-only", file.buffer);
  }

  private normalizeTruckingImportRows(result: DriverTripRateImportSummaryDto) {
    return (result.items ?? []).map((r: any, i: number) => ({
      ...r,
      rateCents: r.rateCents ?? r.amountCents ?? null,
      amountCents: r.amountCents ?? r.rateCents ?? null,
      isActive: r.active !== false,
      sortOrder: Number.isInteger(r.sortOrder) ? r.sortOrder : i,
    }));
  }

  async previewTruckingRatesImport(tenantId: string, file: Express.Multer.File) {
    const parsed = await this.parseTruckingExcelOrThrow(file);
    const normalized = this.normalizeTruckingImportRows(parsed);
    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
    );
    const currentRows = current
      ? await this.prisma.masterRateDatasetRow.findMany({
          where: { tenantId, datasetId: current.id },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
        })
      : [];
    const diff = this.diffTemplateRows(currentRows, normalized);
    return {
      currentVersionNo: current?.versionNo ?? null,
      currentSourceFileName: current?.sourceFileName ?? null,
      uploadedFileName: file.originalname ?? "trucking-rates-import.xlsx",
      sectionCount: this.countQuotationSections(normalized),
      lineCount: normalized.length,
      warnings: (parsed.errors ?? []).map(
        (e) => `Row ${e.rowNumber}: ${e.reason}`,
      ),
      diff,
      items: normalized,
    };
  }

  async replaceDriverTripRateMasters(
    tenantId: string,
    items: Array<Record<string, any>>,
    actorUserId: string | null = null,
    expectedVersionNo?: number | null,
  ) {
    const normalized = (items ?? []).map((r) => {
      const parsed = this.parseTruckingRateOptions(
        r.rawRateText ??
          (Array.isArray(r.rateOptionsJson)
            ? r.rateOptionsJson
                .map((o: any) => o?.amountCents)
                .filter((v: any) => Number.isInteger(v))
                .map((c: number) => (c / 100).toFixed(2))
                .join(" / ")
            : r.amountCents ?? r.rateCents),
      );
      const providedAmount =
        r.amountCents === null || r.amountCents === undefined
          ? r.rateCents === null || r.rateCents === undefined
            ? null
            : Number.isInteger(Number(r.rateCents))
              ? Number(r.rateCents)
              : null
          : Number.isInteger(Number(r.amountCents))
            ? Number(r.amountCents)
            : null;
      const meta =
        r.metadataJson && typeof r.metadataJson === "object"
          ? { ...(r.metadataJson as Record<string, unknown>) }
          : {};
      return {
        tenantId,
        code: String(r.code ?? "").trim(),
        label: String(r.label ?? "").trim(),
        amountCents: providedAmount,
        rateCents: providedAmount,
        currency: String(r.currency ?? "SGD").trim() || "SGD",
        isActive: r.active !== false,
        section: r.section ?? meta.section ?? null,
        category: r.category ?? meta.category ?? null,
        sortOrder: Number.isInteger(r.sortOrder) ? r.sortOrder : undefined,
        rawRateText: r.rawRateText ?? parsed.rawRateText,
        requiresManualAmount:
          r.requiresManualAmount === undefined
            ? parsed.requiresManualAmount
            : !!r.requiresManualAmount,
        hasMultipleRates:
          r.hasMultipleRates === undefined
            ? parsed.hasMultipleRates
            : !!r.hasMultipleRates,
        rateOptionsJson:
          r.rateOptionsJson === undefined ? parsed.rateOptionsJson : r.rateOptionsJson,
        defaultRateOptionIndex:
          r.defaultRateOptionIndex === undefined
            ? parsed.defaultRateOptionIndex
            : r.defaultRateOptionIndex,
        metadataJson: {
          ...meta,
          section: r.section ?? meta.section ?? null,
          category: r.category ?? meta.category ?? null,
        },
      };
    });

    for (const row of normalized) {
      if (!row.code || !row.label) {
        throw new BadRequestException("Each trucking row requires code and label");
      }
      if (row.amountCents !== null && row.amountCents < 0) {
        throw new BadRequestException(`Invalid negative amountCents for ${row.code}`);
      }
    }

    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
    );
    if (!current) {
      throw new BadRequestException(
        "No driver payout (trucking) template configured. Import Excel or create a blank template first.",
      );
    }
    this.assertExpectedVersionNo(
      current.versionNo,
      expectedVersionNo,
      MasterRateDatasetType.TRUCKING_RATES,
    );

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
      normalized,
      actorUserId,
      current.sourceFileName ?? null,
    );

    return {
      items: await this.listDriverTripRateMasters(tenantId),
      dataset: {
        id: dataset.id,
        versionNo: dataset.versionNo,
        isCurrent: true,
      },
    };
  }

  async importTruckingRatesDataset(
    tenantId: string,
    file: Express.Multer.File,
    actorUserId: string | null = null,
    opts?: { confirmReplace?: boolean; expectedVersionNo?: number | null },
  ): Promise<DriverTripRateImportSummaryDto & { summary?: Record<string, unknown> }> {
    // Parse/validate before any DB or storage write so failures never leave partial current.
    const parsed = await this.parseTruckingExcelOrThrow(file);
    const rows = this.normalizeTruckingImportRows(parsed);

    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
    );
    if (current && opts?.confirmReplace !== true) {
      throw new BadRequestException(
        "A current driver payout (trucking) template already exists. Preview the import and confirm replace to proceed.",
      );
    }
    if (current) {
      this.assertExpectedVersionNo(
        current.versionNo,
        opts?.expectedVersionNo,
        MasterRateDatasetType.TRUCKING_RATES,
      );
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".bin";
    const storageKey = `${tenantId}/masters/driver_payout/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${ext}`;
    await this.uploadMasterObject(
      storageKey,
      file.buffer,
      file.mimetype ?? "application/octet-stream",
    );

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
      rows,
      actorUserId,
      file.originalname ?? null,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.masterFile.updateMany({
        where: {
          tenantId,
          type: MasterFileType.DRIVER_PAYOUT,
          isActive: true,
          customerCompanyId: null,
        },
        data: { isActive: false, status: MasterFileStatus.SUPERSEDED },
      });
      await tx.masterFile.create({
        data: {
          tenantId,
          customerCompanyId: null,
          type: MasterFileType.DRIVER_PAYOUT,
          fileName: file.originalname ?? "trucking-rates-import.xlsx",
          fileUrl: storageKey,
          uploadedByUserId: actorUserId,
          uploadedAt: new Date(),
          effectiveDate: null,
          status: MasterFileStatus.PARSED,
          parseSummaryJson: {
            source: "DATASET_IMPORT_AUDIT",
            datasetType: "TRUCKING_RATES",
            datasetId: dataset.id,
            versionNo: dataset.versionNo,
            lineCount: rows.length,
            previousDatasetId: current?.id ?? null,
            previousVersionNo: current?.versionNo ?? null,
          } as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    });
    this.logger.log(
      `Imported trucking dataset tenant=${tenantId} dataset=${dataset.id} insertedRows=${rows.length} sourceFile=${storageKey}`,
    );
    return {
      ...parsed,
      items: await this.listDriverTripRateMasters(tenantId),
      summary: {
        datasetId: dataset.id,
        versionNo: dataset.versionNo,
        isCurrent: true,
        sourceFileStorageKey: storageKey,
        lineCount: rows.length,
      },
    };
  }

  private parseAndNormalizeDhcExcel(file: Express.Multer.File) {
    const name = String(file?.originalname ?? "").toLowerCase();
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    if (!/\.xlsx?$/i.test(name)) {
      throw new BadRequestException("DHC rates import must be Excel (.xlsx/.xls)");
    }
    const parsed = parseDhcExcelBuffer(file.buffer);
    const rows = parsed.items.map((row, index) => {
      const rateOptions: Array<{ label: string; amountCents: number | null }> = [];
      if (row.oldRateCents != null) {
        rateOptions.push({ label: "Old", amountCents: row.oldRateCents });
      }
      if (row.newRateCents != null) {
        rateOptions.push({ label: "New", amountCents: row.newRateCents });
      }
      const deduped = Array.from(
        new Map(rateOptions.map((opt) => [`${opt.label}:${opt.amountCents}`, opt])).values(),
      );
      const hasMultipleRates = deduped.length >= 2;
      const singleAmount = deduped.length === 1 ? deduped[0].amountCents : null;

      return {
        code: row.code,
        label: row.label,
        section: row.section ?? null,
        amountCents: singleAmount,
        rateCents: singleAmount,
        currency: "SGD",
        isActive: true,
        rawRateText: hasMultipleRates
          ? `${row.oldRateCents ?? ""}/${row.newRateCents ?? ""}`
          : null,
        requiresManualAmount: deduped.length === 0,
        hasMultipleRates,
        rateOptionsJson: hasMultipleRates ? deduped : null,
        defaultRateOptionIndex: null,
        metadataJson: {
          section: row.section,
          description: row.description,
          category: row.category,
          unit: row.unit,
          notes: row.notes,
          yardDepot: row.yardDepot,
          oldRateCents: row.oldRateCents,
          newRateCents: row.newRateCents,
          software: row.software,
          operatorCode: row.operatorCode,
          operatorName: row.operatorName,
          effectiveDate: row.effectiveDate ? row.effectiveDate.toISOString() : null,
          sortOrder: index,
        } as Prisma.InputJsonValue,
      };
    });
    return { parsed, rows };
  }

  async previewDhcRatesImport(tenantId: string, file: Express.Multer.File) {
    const { parsed, rows } = this.parseAndNormalizeDhcExcel(file);
    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
    );
    const currentRows = current
      ? await this.prisma.masterRateDatasetRow.findMany({
          where: { tenantId, datasetId: current.id },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
        })
      : [];
    const diff = this.diffTemplateRows(currentRows, rows);
    return {
      currentVersionNo: current?.versionNo ?? null,
      currentSourceFileName: current?.sourceFileName ?? null,
      uploadedFileName: file.originalname ?? "dhc-rates-import.xlsx",
      sectionCount: this.countQuotationSections(rows),
      lineCount: rows.length,
      warnings: parsed.summary?.warnings ?? [],
      diff,
      items: rows,
      summary: parsed.summary,
    };
  }

  async importDhcRatesDataset(
    tenantId: string,
    file: Express.Multer.File,
    actorUserId: string | null = null,
    opts?: { confirmReplace?: boolean; expectedVersionNo?: number | null },
  ): Promise<{ importedCount: number; items: any[]; summary: Record<string, unknown> }> {
    // Parse/validate before any DB or storage write so failures never leave partial current.
    const { parsed, rows } = this.parseAndNormalizeDhcExcel(file);

    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
    );
    if (current && opts?.confirmReplace !== true) {
      throw new BadRequestException(
        "A current DHC rates template already exists. Preview the import and confirm replace to proceed.",
      );
    }
    if (current) {
      this.assertExpectedVersionNo(
        current.versionNo,
        opts?.expectedVersionNo,
        MasterRateDatasetType.DHC_RATES,
      );
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".bin";
    const storageKey = `${tenantId}/masters/dhc_reference/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${ext}`;
    await this.uploadMasterObject(
      storageKey,
      file.buffer,
      file.mimetype ?? "application/octet-stream",
    );

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
      rows,
      actorUserId,
      file.originalname ?? null,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.masterFile.updateMany({
        where: {
          tenantId,
          type: MasterFileType.DHC_REFERENCE,
          isActive: true,
          customerCompanyId: null,
        },
        data: { isActive: false, status: MasterFileStatus.SUPERSEDED },
      });
      await tx.masterFile.create({
        data: {
          tenantId,
          customerCompanyId: null,
          type: MasterFileType.DHC_REFERENCE,
          fileName: file.originalname ?? "dhc-rates-import.xlsx",
          fileUrl: storageKey,
          uploadedByUserId: actorUserId,
          uploadedAt: new Date(),
          effectiveDate: null,
          status: MasterFileStatus.PARSED,
          parseSummaryJson: {
            source: "DATASET_IMPORT_AUDIT",
            datasetType: "DHC_RATES",
            datasetId: dataset.id,
            versionNo: dataset.versionNo,
            lineCount: rows.length,
            previousDatasetId: current?.id ?? null,
            previousVersionNo: current?.versionNo ?? null,
          } as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    });

    return {
      importedCount: rows.length,
      items: await this.listDhcRateDatasetItems(tenantId),
      summary: {
        ...parsed.summary,
        datasetId: dataset.id,
        versionNo: dataset.versionNo,
        isCurrent: true,
        sourceFileStorageKey: storageKey,
        lineCount: rows.length,
        note: "DHC rates imported into tenant dataset (source file stored for audit only).",
      },
    };
  }

  async listDhcRateDatasetItems(tenantId: string) {
    return this.listDatasetRows(tenantId, MasterRateDatasetType.DHC_RATES).then((rows) =>
      rows.map((r: any) => ({
        ...r,
        active: r.isActive,
        amountCents: r.rateCents ?? null,
      })),
    );
  }

  async replaceDhcRatesDataset(
    tenantId: string,
    items: Array<Record<string, any>>,
    actorUserId: string | null = null,
    expectedVersionNo?: number | null,
  ) {
    const normalized = (items ?? []).map((r) => {
      const amountCents =
        r.amountCents === null || r.amountCents === undefined
          ? r.rateCents === null || r.rateCents === undefined
            ? null
            : Number.isInteger(Number(r.rateCents))
              ? Number(r.rateCents)
              : null
          : Number.isInteger(Number(r.amountCents))
            ? Number(r.amountCents)
            : null;
      return {
        tenantId,
        code: String(r.code ?? "").trim(),
        label: String(r.label ?? "").trim(),
        amountCents,
        rateCents: amountCents,
        currency: String(r.currency ?? "SGD").trim() || "SGD",
        isActive: r.active !== false,
        rawRateText: r.rawRateText ?? null,
        requiresManualAmount: !!r.requiresManualAmount,
        hasMultipleRates: !!r.hasMultipleRates,
        rateOptionsJson: r.rateOptionsJson ?? null,
        defaultRateOptionIndex:
          r.defaultRateOptionIndex === null || r.defaultRateOptionIndex === undefined
            ? null
            : Number(r.defaultRateOptionIndex),
        metadataJson: r.metadataJson ?? null,
      };
    });

    for (const row of normalized) {
      if (!row.code || !row.label) {
        throw new BadRequestException("Each DHC row requires code and label");
      }
      if (row.amountCents !== null && row.amountCents < 0) {
        throw new BadRequestException(`Invalid negative amountCents for ${row.code}`);
      }
    }

    const current = await this.findPreferredDataset(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
    );
    if (!current) {
      throw new BadRequestException(
        "No DHC rates template configured. Import Excel or create a blank template first.",
      );
    }
    this.assertExpectedVersionNo(
      current.versionNo,
      expectedVersionNo,
      MasterRateDatasetType.DHC_RATES,
    );

    const dataset = await this.createDatasetVersionWithRows(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
      normalized,
      actorUserId,
      current.sourceFileName ?? null,
    );

    return {
      items: await this.listDhcRateDatasetItems(tenantId),
      dataset: {
        id: dataset.id,
        versionNo: dataset.versionNo,
        isCurrent: true,
      },
    };
  }

  listDhcRatesTemplateVersions(tenantId: string) {
    return this.listTemplateVersions(tenantId, MasterRateDatasetType.DHC_RATES);
  }

  restoreDhcRatesTemplateVersion(
    tenantId: string,
    datasetId: string,
    actorUserId: string | null = null,
    expectedVersionNo?: number | null,
  ) {
    return this.restoreTemplateVersion(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
      datasetId,
      actorUserId,
      expectedVersionNo,
    );
  }

  exportCurrentDhcRatesTemplate(tenantId: string) {
    return this.exportCurrentTemplate(tenantId, MasterRateDatasetType.DHC_RATES);
  }

  createBlankDhcRatesTemplate(tenantId: string, actorUserId: string | null = null) {
    return this.createBlankTemplate(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
      actorUserId,
    );
  }

  listTruckingRatesTemplateVersions(tenantId: string) {
    return this.listTemplateVersions(tenantId, MasterRateDatasetType.TRUCKING_RATES);
  }

  restoreTruckingRatesTemplateVersion(
    tenantId: string,
    datasetId: string,
    actorUserId: string | null = null,
    expectedVersionNo?: number | null,
  ) {
    return this.restoreTemplateVersion(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
      datasetId,
      actorUserId,
      expectedVersionNo,
    );
  }

  exportCurrentTruckingRatesTemplate(tenantId: string) {
    return this.exportCurrentTemplate(tenantId, MasterRateDatasetType.TRUCKING_RATES);
  }

  createBlankTruckingRatesTemplate(
    tenantId: string,
    actorUserId: string | null = null,
  ) {
    return this.createBlankTemplate(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
      actorUserId,
    );
  }
}
