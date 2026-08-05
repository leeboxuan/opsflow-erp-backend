import {
  ConflictException,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  StatisticsDriverRowDto,
  StatisticsDriversExportQueryDto,
  StatisticsExceptionItemDto,
  StatisticsExceptionsExportQueryDto,
  StatisticsFinanceCurrencyGroupDto,
  StatisticsFinanceDto,
  StatisticsFinanceExportQueryDto,
} from "./dto";
import {
  buildStatisticsExportFilename,
  joinStatisticsLimitations,
  serializeStatisticsCsv,
  type StatisticsCsvColumn,
} from "./statistics-csv";
import { resolveStatisticsDateRange } from "./statistics-date-range";
import { StatisticsDriversService } from "./statistics-drivers.service";
import { StatisticsExceptionsService } from "./statistics-exceptions.service";
import { StatisticsFinanceService } from "./statistics-finance.service";

export const MAX_STATISTICS_EXPORT_ROWS = 10_000;
const EXPORT_PAGE_SIZE = 100;

export type StatisticsCsvExport = {
  body: Buffer;
  filename: string;
  rowCount: number;
};

const DRIVER_COLUMNS: readonly StatisticsCsvColumn<
  StatisticsDriverRowDto & { responseLimitations: string }
>[] = [
  { header: "Driver ID", value: (row) => row.driverUserId },
  { header: "Driver Name", value: (row) => row.driverName },
  { header: "Completed Trips", value: (row) => row.completedTrips },
  { header: "Completed Jobs", value: (row) => row.completedJobs },
  {
    header: "Total Valid Duration Ms",
    value: (row) => row.totalValidDurationMs,
  },
  { header: "Average Duration Ms", value: (row) => row.avgDurationMs },
  { header: "Cancelled Trips", value: (row) => row.cancelledTrips },
  { header: "Reassignment Count", value: (row) => row.reassignmentCount },
  {
    header: "Required Document Completion Rate Basis Points",
    value: (row) => row.requiredDocumentCompletionRateBasisPoints,
  },
  {
    header: "Row Limitations",
    value: (row) => joinStatisticsLimitations(row.limitations),
  },
  {
    header: "Response Limitations",
    value: (row) => row.responseLimitations,
  },
];

type FinanceExportRow = {
  group: StatisticsFinanceCurrencyGroupDto | null;
  response: StatisticsFinanceDto;
  responseLimitations: string;
};

const FINANCE_COLUMNS: readonly StatisticsCsvColumn<FinanceExportRow>[] = [
  { header: "Currency", value: (row) => row.group?.currency },
  {
    header: "Job Charges Cents",
    value: (row) => row.group?.jobChargesCents,
  },
  {
    header: "Issued Invoice Value Cents",
    value: (row) => row.group?.issuedInvoiceValueCents,
  },
  {
    header: "Paid Invoice Value Cents",
    value: (row) => row.group?.paidInvoiceValueCents,
  },
  {
    header: "Uninvoiced Ready Value Cents",
    value: (row) => row.group?.uninvoicedReadyValueCents,
  },
  {
    header: "Recorded Trip Payout Cents",
    value: (row) => row.group?.recordedTripPayoutCents,
  },
  {
    header: "Attributable Job Payout Cents",
    value: (row) => row.group?.attributableJobPayoutCents,
  },
  {
    header: "Gross Profit Cents",
    value: (row) => row.group?.grossProfitCents,
  },
  {
    header: "Gross Margin Basis Points",
    value: (row) => row.group?.grossMarginBasisPoints,
  },
  {
    header: "Completed Jobs Missing Charges",
    value: (row) => row.response.exceptionCounts.completedJobsMissingCharges,
  },
  {
    header: "Completed Trips Missing Payouts",
    value: (row) => row.response.exceptionCounts.completedTripsMissingPayouts,
  },
  {
    header: "Excluded From Profit",
    value: (row) => row.response.exceptionCounts.excludedFromProfit,
  },
  {
    header: "Response Limitations",
    value: (row) => row.responseLimitations,
  },
];

type ExceptionExportRow = StatisticsExceptionItemDto & {
  responseLimitations: string;
};

const EXCEPTION_COLUMNS: readonly StatisticsCsvColumn<ExceptionExportRow>[] = [
  { header: "Key", value: (row) => row.key },
  { header: "Severity", value: (row) => row.severity },
  { header: "Entity Type", value: (row) => row.entityType },
  { header: "Entity ID", value: (row) => row.entityId },
  { header: "Job ID", value: (row) => row.jobId },
  { header: "Trip ID", value: (row) => row.tripId },
  { header: "Invoice ID", value: (row) => row.invoiceId },
  {
    header: "Reporting Timestamp",
    value: (row) => row.reportingTimestamp,
  },
  { header: "Explanation", value: (row) => row.explanation },
  { header: "Href", value: (row) => row.href },
  {
    header: "Resolvable In OpsFlow",
    value: (row) => row.resolvableInOpsFlow,
  },
  {
    header: "Response Limitations",
    value: (row) => row.responseLimitations,
  },
];

@Injectable()
export class StatisticsExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: StatisticsDriversService,
    private readonly finance: StatisticsFinanceService,
    private readonly exceptions: StatisticsExceptionsService,
  ) {}

  async exportDrivers(
    tenantId: string,
    query: StatisticsDriversExportQueryDto,
  ): Promise<StatisticsCsvExport> {
    const first = await this.drivers.getDrivers(tenantId, {
      ...query,
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
    });
    this.assertWithinLimit(first.meta.total);

    const expectedTotal = first.meta.total;
    const rows = [...first.data];
    const seen = new Set(rows.map((row) => row.driverUserId));
    const pageCount = Math.ceil(expectedTotal / EXPORT_PAGE_SIZE);
    for (let page = 2; page <= pageCount; page += 1) {
      const next = await this.drivers.getDrivers(tenantId, {
        ...query,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      });
      this.assertStableTotal(expectedTotal, next.meta.total);
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
    if (rows.length !== expectedTotal) {
      throw new ConflictException(
        "Statistics changed during export. Please retry.",
      );
    }

    const range = await this.resolveRange(tenantId, query);
    const responseLimitations = joinStatisticsLimitations(first.limitations);
    return this.toExport(
      "drivers",
      range.from,
      range.to,
      DRIVER_COLUMNS,
      rows.map((row) => ({ ...row, responseLimitations })),
    );
  }

  async exportFinance(
    tenantId: string,
    query: StatisticsFinanceExportQueryDto,
  ): Promise<StatisticsCsvExport> {
    const response = await this.finance.getFinance(tenantId, query);
    const responseLimitations = joinStatisticsLimitations(response.limitations);
    const groups =
      response.currencyGroups.length > 0 ? response.currencyGroups : [null];
    const rows = groups.map((group) => ({
      group,
      response,
      responseLimitations,
    }));
    const range = await this.resolveRange(tenantId, query);
    return this.toExport(
      "finance",
      range.from,
      range.to,
      FINANCE_COLUMNS,
      rows,
    );
  }

  async exportExceptions(
    tenantId: string,
    query: StatisticsExceptionsExportQueryDto,
  ): Promise<StatisticsCsvExport> {
    const response = await this.exceptions.getExceptionsForExport(
      tenantId,
      query,
      MAX_STATISTICS_EXPORT_ROWS,
    );
    this.assertWithinLimit(response.meta.total);
    const range = await this.resolveRange(tenantId, query);
    const responseLimitations = joinStatisticsLimitations(response.limitations);
    return this.toExport(
      "exceptions",
      range.from,
      range.to,
      EXCEPTION_COLUMNS,
      response.data.map((row) => ({ ...row, responseLimitations })),
    );
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

  private async resolveRange(
    tenantId: string,
    query: { from?: string; to?: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return resolveStatisticsDateRange(query, tenant?.timezone);
  }

  private toExport<Row>(
    view: "drivers" | "finance" | "exceptions",
    from: string,
    to: string,
    columns: readonly StatisticsCsvColumn<Row>[],
    rows: readonly Row[],
  ): StatisticsCsvExport {
    return {
      body: Buffer.from(serializeStatisticsCsv(columns, rows), "utf8"),
      filename: buildStatisticsExportFilename(view, from, to),
      rowCount: rows.length,
    };
  }
}
