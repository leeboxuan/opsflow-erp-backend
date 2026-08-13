import {
  StatisticsContainerMovementRowDto,
  StatisticsContainerRowDto,
  StatisticsCustomerRowDto,
  StatisticsDriverRowDto,
  StatisticsExceptionItemDto,
  StatisticsFinanceCurrencyGroupDto,
  StatisticsFleetRowDto,
  StatisticsLaneRowDto,
  StatisticsOverviewDto,
  StatisticsTruckingSummaryDto,
} from "./dto";
import {
  STATISTICS_REPORT_DEFINITIONS,
  StatisticsExcelColumn,
  StatisticsExcelSheet,
  StatisticsExcelWorkbookInput,
} from "./statistics-excel";
import { formatExceptionKeyLabel } from "./statistics-exception-labels";

export { STATISTICS_REPORT_DEFINITIONS };

const DRIVER_COLUMNS: StatisticsExcelColumn<StatisticsDriverRowDto>[] = [
  { header: "Driver", width: 28, type: "text", value: (row) => row.driverName ?? "Unnamed driver" },
  { header: "Completed Trips", width: 16, type: "integer", value: (row) => row.completedTrips },
  { header: "Completed Jobs", width: 16, type: "integer", value: (row) => row.completedJobs },
  { header: "Unique Containers", width: 18, type: "integer", value: (row) => row.uniqueContainers },
  { header: "Container Movements", width: 20, type: "integer", value: (row) => row.containerMovements },
  { header: "Active Days", width: 14, type: "integer", value: (row) => row.activeDays },
  { header: "Avg Trips / Active Day", width: 20, type: "text", value: (row) => row.avgTripsPerActiveDay },
  { header: "Avg Duration", width: 14, type: "duration", value: (row) => row.avgDurationMs },
  { header: "Cancelled Trips", width: 16, type: "integer", value: (row) => row.cancelledTrips },
  { header: "Reassignments", width: 16, type: "integer", value: (row) => row.reassignmentCount },
  {
    header: "Document Completion",
    width: 20,
    type: "percent",
    value: (row) => row.requiredDocumentCompletionRateBasisPoints,
  },
];

const MOVEMENT_COLUMNS: StatisticsExcelColumn<StatisticsContainerMovementRowDto>[] = [
  { header: "Movement Date", width: 20, type: "datetime", value: (row) => row.movementDate },
  { header: "Container No.", width: 18, type: "text", value: (row) => row.containerNo },
  { header: "Size / Type", width: 14, type: "text", value: (row) => row.containerSize },
  { header: "Job No.", width: 18, type: "text", value: (row) => row.jobNo },
  { header: "Job Type", width: 12, type: "text", value: (row) => row.jobType },
  { header: "Customer", width: 24, type: "text", value: (row) => row.customerName },
  { header: "Trip / Movement", width: 22, type: "text", value: (row) => row.tripRef },
  { header: "From", width: 22, type: "text", value: (row) => row.origin },
  { header: "To", width: 22, type: "text", value: (row) => row.destination },
  { header: "Driver", width: 22, type: "text", value: (row) => row.driverName },
  { header: "Vehicle", width: 14, type: "text", value: (row) => row.vehiclePlate },
  { header: "Trailer", width: 14, type: "text", value: (row) => row.trailerNo },
  { header: "Trip Status", width: 14, type: "text", value: (row) => row.tripStatus },
  { header: "Started At", width: 20, type: "datetime", value: (row) => row.startedAt },
  { header: "Completed At", width: 20, type: "datetime", value: (row) => row.completedAt },
  { header: "Duration", width: 12, type: "duration", value: (row) => row.durationMs },
  { header: "Documentation", width: 16, type: "text", value: (row) => row.documentationStatus },
];

const CONTAINER_COLUMNS: StatisticsExcelColumn<StatisticsContainerRowDto>[] = [
  { header: "Container No.", width: 18, type: "text", value: (row) => row.containerNo },
  { header: "Customer", width: 24, type: "text", value: (row) => row.customers },
  { header: "Job No.", width: 22, type: "text", value: (row) => row.jobs },
  { header: "Job Type", width: 14, type: "text", value: (row) => row.jobType },
  { header: "Size / Type", width: 14, type: "text", value: (row) => row.containerSize },
  { header: "Movements", width: 12, type: "integer", value: (row) => row.movements },
  { header: "Drivers Touched", width: 16, type: "integer", value: (row) => row.driversTouched },
  { header: "Drivers", width: 28, type: "text", value: (row) => row.driverNames },
  { header: "Vehicles Used", width: 14, type: "integer", value: (row) => row.vehiclesUsed },
  { header: "Vehicles", width: 22, type: "text", value: (row) => row.vehiclePlates },
  { header: "First Movement", width: 20, type: "datetime", value: (row) => row.firstMovementAt },
  { header: "Last Movement", width: 20, type: "datetime", value: (row) => row.lastMovementAt },
  { header: "First Origin", width: 22, type: "text", value: (row) => row.firstOrigin },
  { header: "Final Destination", width: 22, type: "text", value: (row) => row.finalDestination },
  { header: "Avg Duration", width: 14, type: "duration", value: (row) => row.avgDurationMs },
];

const LANE_COLUMNS: StatisticsExcelColumn<StatisticsLaneRowDto>[] = [
  { header: "Lane", width: 32, type: "text", value: (row) => row.lane },
  { header: "From", width: 22, type: "text", value: (row) => row.origin },
  { header: "To", width: 22, type: "text", value: (row) => row.destination },
  { header: "Movements", width: 12, type: "integer", value: (row) => row.movements },
  { header: "Unique Containers", width: 18, type: "integer", value: (row) => row.uniqueContainers },
  { header: "Unique Jobs", width: 14, type: "integer", value: (row) => row.uniqueJobs },
  { header: "Avg Duration", width: 14, type: "duration", value: (row) => row.avgDurationMs },
  { header: "Drivers Used", width: 14, type: "integer", value: (row) => row.driversUsed },
  { header: "Vehicles Used", width: 14, type: "integer", value: (row) => row.vehiclesUsed },
  { header: "Completed Trips", width: 16, type: "integer", value: (row) => row.completedTrips },
  { header: "Cancelled Trips", width: 16, type: "integer", value: (row) => row.cancelledTrips },
];

const FLEET_COLUMNS: StatisticsExcelColumn<StatisticsFleetRowDto>[] = [
  { header: "Plate No.", width: 16, type: "text", value: (row) => row.plateNo },
  { header: "Vehicle Type", width: 16, type: "text", value: (row) => row.vehicleType },
  { header: "Completed Trips", width: 16, type: "integer", value: (row) => row.completedTrips },
  { header: "Container Movements", width: 20, type: "integer", value: (row) => row.containerMovements },
  { header: "Unique Containers", width: 18, type: "integer", value: (row) => row.uniqueContainers },
  { header: "Active Days", width: 14, type: "integer", value: (row) => row.activeDays },
  { header: "Drivers", width: 28, type: "text", value: (row) => row.drivers },
  { header: "Avg Trips / Active Day", width: 20, type: "text", value: (row) => row.avgTripsPerActiveDay },
  { header: "Avg Duration", width: 14, type: "duration", value: (row) => row.avgTripDurationMs },
  { header: "Cancelled Trips", width: 16, type: "integer", value: (row) => row.cancelledTrips },
  { header: "Last Activity", width: 20, type: "datetime", value: (row) => row.lastActivityAt },
];

type FinanceExcelRow = StatisticsFinanceCurrencyGroupDto;

const FINANCE_COLUMNS: StatisticsExcelColumn<FinanceExcelRow>[] = [
  { header: "Currency", width: 12, type: "text", value: (row) => row.currency },
  { header: "Job Charges", width: 16, type: "money", value: (row) => row.jobChargesCents },
  { header: "Issued Invoices", width: 16, type: "money", value: (row) => row.issuedInvoiceValueCents },
  { header: "Paid Invoices", width: 16, type: "money", value: (row) => row.paidInvoiceValueCents },
  { header: "Ready to Invoice", width: 18, type: "money", value: (row) => row.uninvoicedReadyValueCents },
  { header: "Driver Payout", width: 16, type: "money", value: (row) => row.recordedTripPayoutCents },
  { header: "Gross Profit", width: 16, type: "money", value: (row) => row.grossProfitCents },
  { header: "Gross Margin", width: 14, type: "percent", value: (row) => row.grossMarginBasisPoints },
];

type CustomerExcelRow = StatisticsCustomerRowDto & {
  currency: string;
  jobChargesCents: number;
  issuedInvoiceValueCents: number;
  paidInvoiceValueCents: number;
  uninvoicedReadyValueCents: number;
  recordedDriverPayoutCents: number;
  grossProfitCents: number | null;
  grossMarginBasisPoints: number | null;
};

const CUSTOMER_COLUMNS: StatisticsExcelColumn<CustomerExcelRow>[] = [
  { header: "Customer", width: 28, type: "text", value: (row) => row.customerName },
  { header: "Jobs", width: 10, type: "integer", value: (row) => row.jobs },
  { header: "Completed Jobs", width: 16, type: "integer", value: (row) => row.completedJobs },
  { header: "Unique Containers", width: 18, type: "integer", value: (row) => row.uniqueContainers },
  { header: "Container Movements", width: 20, type: "integer", value: (row) => row.containerMovements },
  { header: "Completed Trips", width: 16, type: "integer", value: (row) => row.completedTrips },
  { header: "Cancelled Trips", width: 16, type: "integer", value: (row) => row.cancelledTrips },
  { header: "Job Type Mix", width: 22, type: "text", value: (row) => row.jobTypeMix },
  { header: "Currency", width: 12, type: "text", value: (row) => row.currency },
  { header: "Job Charges", width: 16, type: "money", value: (row) => row.jobChargesCents },
  { header: "Issued Invoices", width: 16, type: "money", value: (row) => row.issuedInvoiceValueCents },
  { header: "Paid Invoices", width: 16, type: "money", value: (row) => row.paidInvoiceValueCents },
  { header: "Ready to Invoice", width: 18, type: "money", value: (row) => row.uninvoicedReadyValueCents },
  { header: "Driver Payout", width: 16, type: "money", value: (row) => row.recordedDriverPayoutCents },
  { header: "Gross Profit", width: 16, type: "money", value: (row) => row.grossProfitCents },
  { header: "Gross Margin", width: 14, type: "percent", value: (row) => row.grossMarginBasisPoints },
];

const EXCEPTION_COLUMNS: StatisticsExcelColumn<StatisticsExceptionItemDto>[] = [
  { header: "Category", width: 18, type: "text", value: (row) => exceptionCategory(row.key) },
  { header: "Type", width: 28, type: "text", value: (row) => formatExceptionKeyLabel(row.key) },
  { header: "Severity", width: 12, type: "text", value: (row) => row.severity },
  { header: "Job No.", width: 18, type: "text", value: (row) => row.jobNo },
  { header: "Trip", width: 22, type: "text", value: (row) => row.tripRef },
  { header: "Container No.", width: 18, type: "text", value: (row) => row.containerNo },
  { header: "Customer", width: 24, type: "text", value: (row) => row.customerName },
  { header: "Driver", width: 22, type: "text", value: (row) => row.driverName },
  { header: "Invoice No.", width: 16, type: "text", value: (row) => row.invoiceNo },
  { header: "Reported", width: 20, type: "datetime", value: (row) => row.reportingTimestamp },
  { header: "Reason", width: 42, type: "text", value: (row) => row.explanation },
];

function exceptionCategory(key: string): string {
  if (
    key === "ex_job_missing_charges" ||
    key === "ex_ready_not_invoiced" ||
    key === "ex_excluded_from_profit" ||
    key === "ex_orphan_invoice_job_link"
  ) {
    return "Billing";
  }
  if (key === "ex_trip_missing_payout") return "Driver / Cost";
  if (key === "ex_trip_missing_required_docs") return "Documents";
  return "Operations";
}

type SummaryExcelRow = { metric: string; value: string | number | null };

const SUMMARY_COLUMNS: StatisticsExcelColumn<SummaryExcelRow>[] = [
  { header: "Metric", width: 36, type: "text", value: (row) => row.metric },
  { header: "Value", width: 18, type: "text", value: (row) => row.value },
];

export function driversSheet(
  rows: StatisticsDriverRowDto[],
): StatisticsExcelSheet<StatisticsDriverRowDto> {
  return { name: "Drivers", columns: DRIVER_COLUMNS, rows };
}

export function movementsSheet(
  rows: StatisticsContainerMovementRowDto[],
): StatisticsExcelSheet<StatisticsContainerMovementRowDto> {
  return { name: "Container Movements", columns: MOVEMENT_COLUMNS, rows };
}

export function containersSheet(
  rows: StatisticsContainerRowDto[],
): StatisticsExcelSheet<StatisticsContainerRowDto> {
  return { name: "Containers", columns: CONTAINER_COLUMNS, rows };
}

export function lanesSheet(
  rows: StatisticsLaneRowDto[],
): StatisticsExcelSheet<StatisticsLaneRowDto> {
  return { name: "Lanes", columns: LANE_COLUMNS, rows };
}

export function fleetSheet(
  rows: StatisticsFleetRowDto[],
): StatisticsExcelSheet<StatisticsFleetRowDto> {
  return { name: "Fleet", columns: FLEET_COLUMNS, rows };
}

export function financeSheet(
  rows: StatisticsFinanceCurrencyGroupDto[],
): StatisticsExcelSheet<FinanceExcelRow> {
  return { name: "Finance", columns: FINANCE_COLUMNS, rows };
}

export function customersSheet(
  rows: StatisticsCustomerRowDto[],
): StatisticsExcelSheet<CustomerExcelRow> {
  const expanded: CustomerExcelRow[] = [];
  for (const row of rows) {
    const groups = row.currencyGroups.length > 0 ? row.currencyGroups : [
      {
        currency: "—",
        jobChargesCents: 0,
        issuedInvoiceValueCents: 0,
        paidInvoiceValueCents: 0,
        uninvoicedReadyValueCents: 0,
        recordedDriverPayoutCents: 0,
        grossProfitCents: null,
        grossMarginBasisPoints: null,
      },
    ];
    for (const group of groups) {
      expanded.push({ ...row, ...group });
    }
  }
  return { name: "Customers", columns: CUSTOMER_COLUMNS, rows: expanded };
}

export function exceptionsSheet(
  rows: StatisticsExceptionItemDto[],
): StatisticsExcelSheet<StatisticsExceptionItemDto> {
  return { name: "Exceptions", columns: EXCEPTION_COLUMNS, rows };
}

export function truckingSummarySheet(
  summary: StatisticsTruckingSummaryDto,
): StatisticsExcelSheet<SummaryExcelRow> {
  return {
    name: "Summary",
    columns: SUMMARY_COLUMNS,
    rows: [
      { metric: "Unique containers", value: summary.uniqueContainers },
      { metric: "Container movements", value: summary.containerMovements },
      { metric: "Average movements per container", value: summary.averageMovementsPerContainer },
      { metric: "Containers handled by more than one driver", value: summary.containersHandledByMultipleDrivers },
      { metric: "Jobs", value: summary.jobs },
      { metric: "Completed trips", value: summary.completedTrips },
      { metric: "Cancelled trips", value: summary.cancelledTrips },
      { metric: "Import containers", value: summary.importContainers },
      { metric: "Export containers", value: summary.exportContainers },
      { metric: "LCL containers", value: summary.lclContainers },
      { metric: "Collection containers", value: summary.collectionContainers },
    ],
  };
}

export function overviewSummarySheet(
  overview: StatisticsOverviewDto,
): StatisticsExcelSheet<SummaryExcelRow> {
  return {
    name: "Summary",
    columns: SUMMARY_COLUMNS,
    rows: [
      { metric: "Jobs completed", value: overview.operationallyCompletedJobs },
      { metric: "Trips completed", value: overview.completedTrips },
      { metric: "Active trips", value: overview.activePendingTrips },
      { metric: "Cancelled trips", value: overview.cancelledTrips },
      { metric: "Unique containers", value: overview.uniqueContainers },
      { metric: "Container movements", value: overview.containerMovements },
    ],
  };
}

export function workbookInput(base: Omit<StatisticsExcelWorkbookInput, "definitions" | "sheets"> & {
  sheets: StatisticsExcelWorkbookInput["sheets"];
}): StatisticsExcelWorkbookInput {
  return {
    ...base,
    definitions: STATISTICS_REPORT_DEFINITIONS,
  };
}
