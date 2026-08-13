import {
  ConflictException,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  StatisticsDriversExportQueryDto,
  StatisticsExceptionsExportQueryDto,
  StatisticsFiltersQueryDto,
  StatisticsFinanceExportQueryDto,
} from "./dto";
import {
  buildStatisticsExcelFilename,
  buildStatisticsExcelWorkbook,
} from "./statistics-excel";
import {
  containersSheet,
  customersSheet,
  driversSheet,
  exceptionsSheet,
  financeSheet,
  fleetSheet,
  lanesSheet,
  movementsSheet,
  overviewSummarySheet,
  truckingSummarySheet,
  workbookInput,
} from "./statistics-excel-reports";
import { resolveStatisticsDateRange } from "./statistics-date-range";
import { StatisticsCustomersService } from "./statistics-customers.service";
import { StatisticsDriversService } from "./statistics-drivers.service";
import { StatisticsExceptionsService } from "./statistics-exceptions.service";
import { StatisticsFinanceService } from "./statistics-finance.service";
import { StatisticsOverviewService } from "./statistics-overview.service";
import { StatisticsTruckingService } from "./statistics-trucking.service";

export const MAX_STATISTICS_EXPORT_ROWS = 10_000;
const EXPORT_PAGE_SIZE = 100;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type StatisticsFileExport = {
  body: Buffer;
  filename: string;
  rowCount: number;
  contentType: string;
};

/** @deprecated alias kept for existing controller/tests during the Excel cutover */
export type StatisticsCsvExport = StatisticsFileExport;

@Injectable()
export class StatisticsExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: StatisticsDriversService,
    private readonly finance: StatisticsFinanceService,
    private readonly exceptions: StatisticsExceptionsService,
    private readonly trucking: StatisticsTruckingService,
    private readonly customers: StatisticsCustomersService,
    private readonly overview: StatisticsOverviewService,
  ) {}

  async exportDrivers(
    tenantId: string,
    query: StatisticsDriversExportQueryDto,
  ): Promise<StatisticsFileExport> {
    const first = await this.drivers.getDrivers(tenantId, {
      ...query,
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
    });
    this.assertWithinLimit(first.meta.total);
    const rows = [...first.data];
    const seen = new Set(rows.map((row) => row.driverUserId));
    const pageCount = Math.ceil(first.meta.total / EXPORT_PAGE_SIZE);
    for (let page = 2; page <= pageCount; page += 1) {
      const next = await this.drivers.getDrivers(tenantId, {
        ...query,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      });
      this.assertStableTotal(first.meta.total, next.meta.total);
      for (const row of next.data) {
        if (seen.has(row.driverUserId)) {
          throw new ConflictException(
            "Statistics changed during export. Please retry.",
          );
        }
        seen.add(row.driverUserId);
        rows.push(row);
      }
    }
    const meta = await this.workbookMeta(tenantId, query, "OpsFlow — Drivers Report");
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...meta,
        limitations: first.limitations,
        sheets: [driversSheet(rows)],
      }),
    );
    return {
      body,
      filename: buildStatisticsExcelFilename("Drivers", meta.periodFrom, meta.periodTo),
      rowCount: rows.length,
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  async exportFinance(
    tenantId: string,
    query: StatisticsFinanceExportQueryDto,
  ): Promise<StatisticsFileExport> {
    const response = await this.finance.getFinance(tenantId, query);
    const meta = await this.workbookMeta(tenantId, query, "OpsFlow — Finance Report");
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...meta,
        limitations: response.limitations,
        sheets: [financeSheet(response.currencyGroups)],
      }),
    );
    return {
      body,
      filename: buildStatisticsExcelFilename("Finance", meta.periodFrom, meta.periodTo),
      rowCount: response.currencyGroups.length,
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  async exportExceptions(
    tenantId: string,
    query: StatisticsExceptionsExportQueryDto,
  ): Promise<StatisticsFileExport> {
    const response = await this.exceptions.getExceptionsForExport(
      tenantId,
      query,
      MAX_STATISTICS_EXPORT_ROWS,
    );
    this.assertWithinLimit(response.meta.total);
    const meta = await this.workbookMeta(tenantId, query, "OpsFlow — Exceptions Report");
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...meta,
        limitations: response.limitations,
        sheets: [exceptionsSheet(response.data)],
      }),
    );
    return {
      body,
      filename: buildStatisticsExcelFilename(
        "Exceptions",
        meta.periodFrom,
        meta.periodTo,
      ),
      rowCount: response.data.length,
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  async exportTrucking(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsFileExport> {
    const [summary, movements, containers, lanes, fleet] = await Promise.all([
      this.trucking.getSummary(tenantId, query),
      this.trucking.getAllMovements(tenantId, query),
      this.trucking.getAllContainers(tenantId, query),
      this.trucking.getAllLanes(tenantId, query),
      this.trucking.getAllFleet(tenantId, query),
    ]);
    this.assertWithinLimit(movements.length);
    const meta = await this.workbookMeta(tenantId, query, "OpsFlow — Trucking Report");
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...meta,
        limitations: summary.limitations,
        sheets: [
          truckingSummarySheet(summary),
          movementsSheet(movements),
          containersSheet(containers),
          lanesSheet(lanes),
          fleetSheet(fleet.vehicles),
        ],
      }),
    );
    return {
      body,
      filename: buildStatisticsExcelFilename(
        "Trucking",
        meta.periodFrom,
        meta.periodTo,
      ),
      rowCount: movements.length,
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  async exportCustomers(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsFileExport> {
    const rows = await this.customers.getAllCustomers(tenantId, query);
    this.assertWithinLimit(rows.length);
    const meta = await this.workbookMeta(tenantId, query, "OpsFlow — Customers Report");
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...meta,
        limitations: [...new Set(rows.flatMap(() => []))],
        sheets: [customersSheet(rows)],
      }),
    );
    return {
      body,
      filename: buildStatisticsExcelFilename(
        "Customers",
        meta.periodFrom,
        meta.periodTo,
      ),
      rowCount: rows.length,
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  async exportManagement(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    options?: { includeFinance?: boolean; includeExceptions?: boolean },
  ): Promise<StatisticsFileExport> {
    const includeFinance = options?.includeFinance !== false;
    const includeExceptions = options?.includeExceptions !== false;
    const [overview, summary, movements, containers, driverPage, fleet] =
      await Promise.all([
        this.overview.getOverview(tenantId, query),
        this.trucking.getSummary(tenantId, query),
        this.trucking.getAllMovements(tenantId, query),
        this.trucking.getAllContainers(tenantId, query),
        this.drivers.getDrivers(tenantId, {
          ...query,
          page: 1,
          pageSize: EXPORT_PAGE_SIZE,
          sortBy: "completedTrips",
          sortDir: "desc",
        }),
        this.trucking.getAllFleet(tenantId, query),
      ]);
    this.assertWithinLimit(movements.length);
    const driverRows = [...driverPage.data];
    const driverPages = Math.ceil(driverPage.meta.total / EXPORT_PAGE_SIZE);
    for (let page = 2; page <= driverPages; page += 1) {
      const next = await this.drivers.getDrivers(tenantId, {
        ...query,
        page,
        pageSize: EXPORT_PAGE_SIZE,
        sortBy: "completedTrips",
        sortDir: "desc",
      });
      driverRows.push(...next.data);
    }
    const customerRows = await this.customers.getAllCustomers(tenantId, query);
    const sheets: Array<{ name: string; columns: readonly unknown[]; rows: readonly unknown[] }> = [
      overviewSummarySheet(overview),
      truckingSummarySheet(summary),
      movementsSheet(movements),
      containersSheet(containers),
      driversSheet(driverRows),
      customersSheet(customerRows),
      fleetSheet(fleet.vehicles),
    ];
    const limitations = [...overview.limitations, ...summary.limitations];
    if (includeFinance) {
      const finance = await this.finance.getFinance(tenantId, query);
      sheets.push(financeSheet(finance.currencyGroups));
      limitations.push(...finance.limitations);
    }
    if (includeExceptions) {
      const exceptions = await this.exceptions.getExceptionsForExport(
        tenantId,
        query,
        MAX_STATISTICS_EXPORT_ROWS,
      );
      sheets.push(exceptionsSheet(exceptions.data));
      limitations.push(...exceptions.limitations);
    }
    const meta = await this.workbookMeta(
      tenantId,
      query,
      "OpsFlow — Management Report",
    );
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...meta,
        limitations: Array.from(new Set(limitations)),
        sheets: sheets as never,
      }),
    );
    return {
      body,
      filename: buildStatisticsExcelFilename(
        "Management-Report",
        meta.periodFrom,
        meta.periodTo,
      ),
      rowCount: movements.length,
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  private assertWithinLimit(total: number): void {
    if (total > MAX_STATISTICS_EXPORT_ROWS) {
      throw new PayloadTooLargeException(
        `Export exceeds ${MAX_STATISTICS_EXPORT_ROWS} rows. Narrow the filters and retry.`,
      );
    }
  }

  private assertStableTotal(expected: number, actual: number): void {
    this.assertWithinLimit(actual);
    if (actual !== expected) {
      throw new ConflictException(
        "Statistics changed during export. Please retry.",
      );
    }
  }

  private async workbookMeta(
    tenantId: string,
    query: { from?: string; to?: string; customerId?: string; jobId?: string; driverId?: string; vehicleId?: string; containerNo?: string },
    title: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true, name: true },
    });
    const range = resolveStatisticsDateRange(query, tenant?.timezone);
    const filters: string[] = [];
    if (query.customerId) filters.push("Customer filter applied");
    if (query.jobId) filters.push("Job filter applied");
    if (query.driverId) filters.push("Driver filter applied");
    if (query.vehicleId) filters.push("Vehicle filter applied");
    if (query.containerNo) filters.push(`Container ${query.containerNo}`);
    return {
      title,
      companyName: tenant?.name ?? "OpsFlow",
      periodFrom: range.from,
      periodTo: range.to,
      generatedAt: new Date(),
      timeZone: range.timeZone,
      filters,
    };
  }
}
