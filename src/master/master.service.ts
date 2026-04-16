import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  MasterFileStatus,
  MasterFileType,
  Prisma,
} from "@prisma/client";
import {
  parseQuotationRateLinesFromDocxBuffer,
  parseQuotationRateLinesFromXlsxBuffer,
} from "../customers/quotation-parse.helpers";
import {
  CreateDriverTripRateMasterDto,
  DriverTripRateImportSummaryDto,
  UpdateDriverTripRateMasterDto,
} from "./dto/driver-trip-rate-master.dto";

@Injectable()
export class MasterDataService {
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

  private async parsePdfTabular(buffer: Buffer): Promise<string[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      return String(data?.text ?? "")
        .split(/\r?\n/)
        .map((l: string) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
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
    const isDocx =
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.docx$/i.test(name);
    const isPdf = mime === "application/pdf" || /\.pdf$/i.test(name);
    const isExcel = /\.xlsx?$/i.test(name);

    if (!isDocx && !isPdf && !isExcel) {
      throw new BadRequestException("Quotation must be DOCX, PDF, XLSX, or XLS");
    }

    const lines = isDocx
      ? await parseQuotationRateLinesFromDocxBuffer(file.buffer)
      : isExcel
        ? parseQuotationRateLinesFromXlsxBuffer(file.buffer)
        : [];

    if (lines.length > 0) {
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
          notes: l.notes ?? null,
          sortOrder: l.sortOrder,
          active: true,
        })),
        summary: {
          lineCount: lines.length,
          note: isDocx
            ? "DOCX parsed on upload (best effort). Structured extraction is not guaranteed."
            : "Structured quotation rows parsed on upload.",
        },
        status: MasterFileStatus.PARSED,
      };
    }

    if (isPdf) {
      const textLines = await this.parsePdfTabular(file.buffer);
      return {
        items: [] as any[],
        summary: {
          note:
            textLines.length > 0
              ? "PDF uploaded. Structured extraction is not guaranteed; no deterministic rows parsed."
              : "PDF uploaded. Parser unavailable or no parsable text found.",
          textLineCount: textLines.length,
        },
        status: MasterFileStatus.PARSE_FAILED,
      };
    }

    return {
      items: [] as any[],
      summary: { note: "No structured quotation rows parsed from uploaded file." },
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
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return null;
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (!rows.length) return null;
    const header = rows[0].map((c: any) => String(c ?? "").trim().toLowerCase());
    const idx = (n: string) => header.findIndex((h: string) => h === n);
    return { rows, idx };
  }

  private parseDriverPayoutItems(buffer: Buffer) {
    const parsed = this.parseControlledSheetRows(buffer);
    if (!parsed || !parsed.rows.length) return { items: [], summary: { note: "No rows found" } };
    const { rows, idx } = parsed;
    const idxCode = idx("code");
    const idxLabel = idx("label");
    const idxRate = idx("ratecents") >= 0 ? idx("ratecents") : idx("rate");
    if (idxCode < 0 || idxLabel < 0 || idxRate < 0) {
      throw new BadRequestException("Driver payout Excel must include code, label, and rate/rateCents");
    }
    const items: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const code = String(r[idxCode] ?? "").trim();
      const label = String(r[idxLabel] ?? "").trim();
      const rateCents = idx("ratecents") >= 0
        ? Number(String(r[idxRate] ?? "").replace(/[$,\s]/g, ""))
        : this.parseMoney(r[idxRate]);
      if (!code || !label || rateCents == null || Number.isNaN(rateCents) || rateCents < 0) continue;
      items.push({
        section: idx("section") >= 0 ? String(r[idx("section")] ?? "").trim() || null : null,
        code,
        label,
        description: idx("description") >= 0 ? String(r[idx("description")] ?? "").trim() || null : null,
        category: idx("category") >= 0 ? String(r[idx("category")] ?? "").trim() || null : null,
        containerSize: idx("containersize") >= 0 ? String(r[idx("containersize")] ?? "").trim() || null : null,
        tripMode: idx("tripmode") >= 0 ? String(r[idx("tripmode")] ?? "").trim() || null : null,
        areaScope: idx("areascope") >= 0 ? String(r[idx("areascope")] ?? "").trim() || null : null,
        unit: idx("unit") >= 0 ? String(r[idx("unit")] ?? "").trim() || null : null,
        rateCents: Math.round(Number(rateCents)),
        notes: idx("notes") >= 0 ? String(r[idx("notes")] ?? "").trim() || null : null,
        isSelectableForTripEarning: true,
        sortOrder: i - 1,
        active: true,
      });
    }
    return { items, summary: { lineCount: items.length } };
  }

  private async parseDhcItems(file: Express.Multer.File) {
    const name = String(file.originalname ?? "").toLowerCase();
    const isPdf = String(file.mimetype ?? "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(name);
    if (!isPdf) throw new BadRequestException("DHC reference upload must be PDF");
    const lines = await this.parsePdfTabular(file.buffer);
    const items = lines
      .map((line, i) => {
        const m = line.match(/^([A-Z0-9._-]+)\s+(.+?)\s+(-?\$?\d[\d,]*(?:\.\d{1,2})?)$/i);
        if (!m) return null;
        const cents = this.parseMoney(m[3]);
        if (cents == null) return null;
        return {
          code: m[1].trim(),
          label: m[2].trim(),
          description: null,
          category: null,
          unit: null,
          rateCents: cents,
          notes: "Parsed from PDF (best effort)",
          sortOrder: i,
          active: true,
        };
      })
      .filter(Boolean) as any[];
    return {
      items,
      summary: items.length
        ? { lineCount: items.length, note: "PDF parsed on upload (best effort)." }
        : { note: "PDF uploaded. Structured extraction is not guaranteed; no deterministic DHC rows parsed." },
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
    const scopedCustomerCompanyId =
      type === MasterFileType.CUSTOMER_QUOTATION ? providedCustomerCompanyId : null;

    if (type === MasterFileType.CUSTOMER_QUOTATION && !scopedCustomerCompanyId) {
      throw new BadRequestException(
        "CUSTOMER_QUOTATION upload requires customerCompanyId",
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
    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".bin";
    const key = `${tenantId}/masters/${type.toLowerCase()}/${Date.now()}${ext}`;
    await this.uploadMasterObject(key, file.buffer, file.mimetype ?? "application/octet-stream");

    let parsed:
      | { items: any[]; summary: Record<string, unknown>; status?: MasterFileStatus }
      | undefined;
    if (type === MasterFileType.CUSTOMER_QUOTATION) {
      parsed = await this.parseQuotationItemsFromFile(file);
    } else if (type === MasterFileType.DRIVER_PAYOUT) {
      parsed = this.parseDriverPayoutItems(file.buffer);
    } else {
      parsed = await this.parseDhcItems(file);
    }

    const status = parsed.status ?? (parsed.items.length > 0 ? MasterFileStatus.PARSED : MasterFileStatus.PARSE_FAILED);

    const masterFile = await this.prisma.$transaction(async (tx) => {
      await tx.masterFile.updateMany({
        where: {
          tenantId,
          type,
          isActive: true,
          ...(type === MasterFileType.CUSTOMER_QUOTATION
            ? { customerCompanyId: scopedCustomerCompanyId }
            : { customerCompanyId: null }),
        },
        data: { isActive: false, status: MasterFileStatus.SUPERSEDED },
      });
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
          isActive: true,
        },
      });
      if (type === MasterFileType.CUSTOMER_QUOTATION && parsed.items.length) {
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
    if (type === MasterFileType.CUSTOMER_QUOTATION && !customerCompanyId) {
      throw new BadRequestException("customerCompanyId is required for CUSTOMER_QUOTATION");
    }
    const active = await this.prisma.masterFile.findFirst({
      where: {
        tenantId,
        type,
        isActive: true,
        ...(type === MasterFileType.CUSTOMER_QUOTATION
          ? { customerCompanyId: customerCompanyId ?? null }
          : { customerCompanyId: null }),
      },
      orderBy: { uploadedAt: "desc" },
    });
    if (!active) return { masterFile: null, items: [] };
    if (type === MasterFileType.CUSTOMER_QUOTATION) {
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
    if (
      masterFile.type === MasterFileType.CUSTOMER_QUOTATION &&
      !masterFile.customerCompanyId
    ) {
      throw new BadRequestException(
        "Invalid CUSTOMER_QUOTATION master scope: customerCompanyId is missing",
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
    if (masterFile.type === MasterFileType.CUSTOMER_QUOTATION) {
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
      if (masterFile.type === MasterFileType.CUSTOMER_QUOTATION) {
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

  listDriverTripRateMasters(tenantId: string) {
    return this.prisma.driverTripRateMaster.findMany({
      where: { tenantId },
      orderBy: [{ active: "desc" }, { code: "asc" }],
    });
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
        amountCents: dto.amountCents,
        currency: dto.currency?.trim() || "SGD",
        active: dto.active ?? true,
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
      return { createdCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };
    }

    const sheet = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) {
      return { createdCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };
    }

    const header = rows[0].map((c: any) => String(c).trim().toLowerCase());
    const idxCode = header.findIndex((h: string) => h === "code");
    const idxLabel = header.findIndex((h: string) => h === "label");
    const idxAmountCents = header.findIndex((h: string) => h === "amountcents");
    const idxAmount = header.findIndex((h: string) => h === "amount");
    const idxCurrency = header.findIndex((h: string) => h === "currency");
    const idxActive = header.findIndex((h: string) => h === "active");

    if (idxCode < 0 || idxLabel < 0 || (idxAmountCents < 0 && idxAmount < 0)) {
      throw new BadRequestException(
        "Excel must contain headers: code, label, and amountCents (or amount).",
      );
    }

    const existing = await this.prisma.driverTripRateMaster.findMany({
      where: { tenantId },
      select: { code: true },
    });
    const existingCodeSet = new Set(existing.map((e) => e.code));

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ rowNumber: number; reason: string }> = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;
      if (!Array.isArray(row) || row.every((c) => String(c ?? "").trim() === "")) {
        continue;
      }

      const code = String(row[idxCode] ?? "").trim();
      const label = String(row[idxLabel] ?? "").trim();
      const rawAmount =
        idxAmountCents >= 0 ? row[idxAmountCents] : row[idxAmount];
      const amountNum = Number(String(rawAmount ?? "").replace(/[$,\s]/g, ""));
      const amountCents =
        idxAmountCents >= 0
          ? Math.round(amountNum)
          : Number.isNaN(amountNum)
            ? Number.NaN
            : Math.round(amountNum * 100);
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
      if (Number.isNaN(amountCents) || amountCents < 0) {
        skippedCount += 1;
        errors.push({ rowNumber, reason: `amount is invalid for code ${code}` });
        continue;
      }

      const isExisting = existingCodeSet.has(code);
      await this.prisma.driverTripRateMaster.upsert({
        where: { tenantId_code: { tenantId, code } },
        update: {
          label,
          amountCents,
          currency,
          active,
        },
        create: {
          tenantId,
          code,
          label,
          amountCents,
          currency,
          active,
        },
      });

      if (isExisting) updatedCount += 1;
      else {
        createdCount += 1;
        existingCodeSet.add(code);
      }
    }

    return { createdCount, updatedCount, skippedCount, errors };
  }
}
