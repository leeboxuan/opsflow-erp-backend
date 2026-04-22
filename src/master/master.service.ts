import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
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
} from "../customers/quotation-parse.helpers";
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
  ) {}
  private readonly MASTER_BUCKET = "job-documents";

  listSingaporePorts() {
    return this.prisma.masterSingaporePort.findMany({
      orderBy: { code: "asc" },
    });
  }

  listSingaporeDepots() {
    return this.prisma.masterSingaporeDepot.findMany({
      orderBy: { code: "asc" },
    });
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
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          label: `${row.code} — ${row.name}`,
        })),
      );
  }

  async getLogisticsLocationById(id: string) {
    const row = await this.prisma.masterLogisticsLocation.findUnique({
      where: { id },
    });
    if (!row || !row.isActive) {
      throw new NotFoundException("Logistics location not found");
    }
    return {
      ...row,
      label: `${row.code} — ${row.name}`,
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
            rateCents: r.rateCents ?? null,
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
        where: { tenantId, type, status: MasterRateDatasetStatus.ACTIVE },
        orderBy: { versionNo: "desc" },
      })) ??
      (await this.prisma.masterRateDataset.findFirst({
        where: { tenantId, type },
        orderBy: { versionNo: "desc" },
      }))
    );
  }

  async getDatasetMetadata(tenantId: string, type: MasterRateDatasetType) {
    const dataset = await this.findPreferredDataset(tenantId, type);
    if (!dataset) return { dataset: null };
    const user = dataset.importedByUserId
      ? await this.prisma.user.findUnique({
          where: { id: dataset.importedByUserId },
          select: { id: true, name: true, email: true },
        })
      : null;
    return {
      dataset: {
        id: dataset.id,
        tenantId: dataset.tenantId,
        type: dataset.type,
        versionNo: dataset.versionNo,
        status: dataset.status,
        importedAt: dataset.importedAt,
        importedByUserId: dataset.importedByUserId,
        importedByName: user?.name ?? null,
        importedByEmail: user?.email ?? null,
        sourceFileName: dataset.sourceFileName ?? null,
        activatedAt: dataset.activatedAt,
        activatedByUserId: dataset.activatedByUserId,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt,
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
            rateCents: r.rateCents ?? null,
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

  async importQuotationDataset(
    tenantId: string,
    file: Express.Multer.File,
    actorUserId: string | null = null,
  ): Promise<{ importedCount: number; items: any[]; summary: Record<string, unknown> }> {
    const name = String(file?.originalname ?? "").toLowerCase();
    const isExcel = /\.xlsx?$/i.test(name);
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    if (!isExcel) {
      throw new BadRequestException("Quotation import must be Excel (.xlsx/.xls)");
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
    const normalized = lines.map((l, index) => ({
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
      sourceType: l.sourceType ?? "EXCEL_IMPORT",
      metadataJson: ({
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
        additionalRuleText: l.additionalRuleText ?? (l.metadataJson as any)?.additionalRuleText ?? null,
        rawValueText: l.rawRateText ?? (l.metadataJson as any)?.rawValueText ?? null,
        parserSourceType: (l.metadataJson as any)?.parserSourceType ?? "PARSER_ANNEX_MATRIX",
      } as Prisma.InputJsonValue),
    }));

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
        sourceFileStorageKey: storageKey,
        lineCount: normalized.length,
        reconciliation,
        note: "Quotation dataset imported from Excel (source file stored for audit only).",
      },
    };
  }

  async listQuotationDatasetItems(tenantId: string) {
    return this.listDatasetRows(tenantId, MasterRateDatasetType.QUOTATION).then((rows) =>
      rows.map((r: any) => ({ ...r, active: r.isActive })),
    );
  }

  async replaceQuotationDatasetItems(
    tenantId: string,
    items: Array<Record<string, any>>,
    actorUserId: string | null = null,
  ) {
    const normalized = (items ?? []).map((r, index) => ({
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
      rateCents:
        r.rateCents === null || r.rateCents === undefined
          ? null
          : Number.isInteger(Number(r.rateCents))
            ? Number(r.rateCents)
            : null,
      requiresManualAmount: !!r.requiresManualAmount,
      rawRateText: r.rawRateText ?? null,
      notes: r.notes ?? null,
      sortOrder: Number.isInteger(Number(r.sortOrder)) ? Number(r.sortOrder) : index,
      isActive: r.active !== false,
      sourceType: "MANUAL_EDIT",
    }));

    for (const row of normalized) {
      if (!row.code || !row.label) {
        throw new BadRequestException("Each item requires non-empty code and label");
      }
      if (row.rateCents !== null && row.rateCents < 0) {
        throw new BadRequestException(`Invalid negative rateCents for item ${row.code}`);
      }
    }

    await this.replaceDatasetRows(
      tenantId,
      MasterRateDatasetType.QUOTATION,
      normalized,
      actorUserId,
    );

    return this.listQuotationDatasetItems(tenantId);
  }

  listDriverTripRateMasters(tenantId: string) {
    return this.listDatasetRows(tenantId, MasterRateDatasetType.TRUCKING_RATES).then((rows) =>
      rows.map((r: any) => ({ ...r, active: r.isActive })),
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

  async replaceDriverTripRateMasters(
    tenantId: string,
    items: Array<Record<string, any>>,
    actorUserId: string | null = null,
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
            : r.amountCents),
      );
      const providedAmount =
        r.amountCents === null || r.amountCents === undefined
          ? null
          : Number.isInteger(Number(r.amountCents))
            ? Number(r.amountCents)
            : null;
      return {
        tenantId,
        code: String(r.code ?? "").trim(),
        label: String(r.label ?? "").trim(),
        amountCents: providedAmount,
        currency: String(r.currency ?? "SGD").trim() || "SGD",
        isActive: r.active !== false,
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

    await this.replaceDatasetRows(
      tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
      normalized,
      actorUserId,
    );

    return this.listDriverTripRateMasters(tenantId);
  }

  async importTruckingRatesDataset(
    tenantId: string,
    file: Express.Multer.File,
    actorUserId: string | null = null,
  ): Promise<DriverTripRateImportSummaryDto> {
    const name = String(file?.originalname ?? "").toLowerCase();
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    if (!/\.xlsx?$/i.test(name)) {
      throw new BadRequestException("Trucking rates import must be Excel (.xlsx/.xls)");
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
    const result = await this.importDriverTripRateMastersFromExcel(tenantId, file.buffer);
    const rows = (result.items ?? []).map((r: any, i: number) => ({
      ...r,
      isActive: r.active !== false,
      sortOrder: Number.isInteger(r.sortOrder) ? r.sortOrder : i,
    }));
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
          } as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    });
    this.logger.log(
      `Imported trucking dataset tenant=${tenantId} dataset=${dataset.id} insertedRows=${rows.length} sourceFile=${storageKey}`,
    );
    return {
      ...result,
      items: await this.listDriverTripRateMasters(tenantId),
    };
  }

  async importDhcRatesDataset(
    tenantId: string,
    file: Express.Multer.File,
    actorUserId: string | null = null,
  ): Promise<{ importedCount: number; items: any[]; summary: Record<string, unknown> }> {
    const name = String(file?.originalname ?? "").toLowerCase();
    if (!file?.buffer?.length) throw new BadRequestException("file is required");
    if (!/\.xlsx?$/i.test(name)) {
      throw new BadRequestException("DHC rates import must be Excel (.xlsx/.xls)");
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
    const buffer = file.buffer;
    const parsed = parseDhcExcelBuffer(buffer);
    const rows = parsed.items.map((row, index) => {
      const rateOptions: Array<{ label: string; amountCents: number | null }> = [];
      if (row.oldRateCents != null) rateOptions.push({ label: "Old", amountCents: row.oldRateCents });
      if (row.newRateCents != null) rateOptions.push({ label: "New", amountCents: row.newRateCents });
      const deduped = Array.from(
        new Map(rateOptions.map((opt) => [`${opt.label}:${opt.amountCents}`, opt])).values(),
      );
      const hasMultipleRates = deduped.length >= 2;
      const singleAmount = deduped.length === 1 ? deduped[0].amountCents : null;

      return {
        code: row.code,
        label: row.label,
        amountCents: singleAmount,
        currency: "SGD",
        isActive: true,
        rawRateText: hasMultipleRates ? `${row.oldRateCents ?? ""}/${row.newRateCents ?? ""}` : null,
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
        sourceFileStorageKey: storageKey,
        lineCount: rows.length,
        note: "DHC rates imported into tenant dataset (source file stored for audit only).",
      },
    };
  }

  async listDhcRateDatasetItems(tenantId: string) {
    return this.listDatasetRows(tenantId, MasterRateDatasetType.DHC_RATES).then((rows) =>
      rows.map((r: any) => ({ ...r, active: r.isActive })),
    );
  }

  async replaceDhcRatesDataset(
    tenantId: string,
    items: Array<Record<string, any>>,
    actorUserId: string | null = null,
  ) {
    const normalized = (items ?? []).map((r) => ({
      tenantId,
      code: String(r.code ?? "").trim(),
      label: String(r.label ?? "").trim(),
      amountCents:
        r.amountCents === null || r.amountCents === undefined
          ? null
          : Number.isInteger(Number(r.amountCents))
            ? Number(r.amountCents)
            : null,
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
    }));

    for (const row of normalized) {
      if (!row.code || !row.label) {
        throw new BadRequestException("Each DHC row requires code and label");
      }
      if (row.amountCents !== null && row.amountCents < 0) {
        throw new BadRequestException(`Invalid negative amountCents for ${row.code}`);
      }
    }

    await this.replaceDatasetRows(
      tenantId,
      MasterRateDatasetType.DHC_RATES,
      normalized,
      actorUserId,
    );

    return this.listDhcRateDatasetItems(tenantId);
  }
}
