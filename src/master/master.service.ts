import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateDriverTripRateMasterDto,
  DriverTripRateImportSummaryDto,
  UpdateDriverTripRateMasterDto,
} from "./dto/driver-trip-rate-master.dto";

@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

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
