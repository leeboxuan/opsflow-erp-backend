import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  StatisticsCurrencyAmountDto,
  StatisticsDriverRowDto,
  StatisticsDriversQueryDto,
  StatisticsExceptionItemDto,
  StatisticsExceptionsQueryDto,
  StatisticsFiltersQueryDto,
  StatisticsFinanceDto,
  StatisticsFinanceQueryDto,
  StatisticsOverviewDto,
} from "./dto";
import {
  STATISTICS_DRIVER_SORT_FIELDS,
  STATISTICS_EXCEPTION_DEFINITIONS,
  STATISTICS_EXCEPTION_KEYS,
} from "./statistics.constants";

async function validateQuery<T extends object>(
  type: new () => T,
  input: Record<string, unknown>,
) {
  const dto = plainToInstance(type, input);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

describe("Statistics V1 DTO contracts", () => {
  describe("shared filters", () => {
    it("accepts date-only ranges and tenant-scoped identifier shapes", async () => {
      const { errors } = await validateQuery(StatisticsFiltersQueryDto, {
        from: "2026-07-01",
        to: "2026-07-31",
        customerId: "cm_customer-1",
        jobId: "job_1",
        tripId: "trip-1",
        driverId: "driver_1",
        vehicleId: "vehicle-1",
      });
      expect(errors).toHaveLength(0);
    });

    it.each([
      [{ from: "07/01/2026" }, "from"],
      [{ to: "2026-02-30" }, "to"],
      [{ from: "2026-08-02", to: "2026-08-01" }, "to"],
      [{ jobId: "job id with spaces" }, "jobId"],
      [{ driverId: "../driver" }, "driverId"],
      [{ vehicleId: "" }, "vehicleId"],
    ])("rejects malformed filters", async (input, property) => {
      const { errors } = await validateQuery(StatisticsFiltersQueryDto, input);
      expect(errors.some((error) => error.property === property)).toBe(true);
    });

    it("does not expose or silently accept Route and Trailer filters", async () => {
      const { dto, errors } = await validateQuery(StatisticsFiltersQueryDto, {
        routeId: "route-1",
        trailerId: "trailer-1",
      });
      expect("routeId" in dto).toBe(true);
      expect("trailerId" in dto).toBe(true);
      expect(errors.map((error) => error.property).sort()).toEqual([
        "routeId",
        "trailerId",
      ]);
      expect(
        Object.prototype.hasOwnProperty.call(
          StatisticsFiltersQueryDto.prototype,
          "routeId",
        ),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(
          StatisticsFiltersQueryDto.prototype,
          "trailerId",
        ),
      ).toBe(false);
    });
  });

  describe("endpoint-specific filters and pagination", () => {
    it("transforms valid operational driver pagination and sort values", async () => {
      const { dto, errors } = await validateQuery(StatisticsDriversQueryDto, {
        page: "2",
        pageSize: "50",
        sortBy: "avgDurationMs",
        sortDir: "asc",
      });
      expect(errors).toHaveLength(0);
      expect(dto.page).toBe(2);
      expect(dto.pageSize).toBe(50);
      expect(dto.sortBy).toBe("avgDurationMs");
    });

    it.each(["completedTrips", "avgDurationMs"] as const)(
      "accepts approved operational driver sort field %s",
      async (sortBy) => {
        const { errors } = await validateQuery(StatisticsDriversQueryDto, {
          sortBy,
        });
        expect(errors).toHaveLength(0);
      },
    );

    it("rejects recordedPayoutCents as a Driver sort field", async () => {
      expect(STATISTICS_DRIVER_SORT_FIELDS).not.toContain(
        "recordedPayoutCents",
      );
      const { errors } = await validateQuery(StatisticsDriversQueryDto, {
        sortBy: "recordedPayoutCents",
      });
      expect(errors.some((error) => error.property === "sortBy")).toBe(true);
    });

    it.each([
      [{ page: "0" }, "page"],
      [{ page: "101" }, "page"],
      [{ pageSize: "0" }, "pageSize"],
      [{ pageSize: "101" }, "pageSize"],
      [{ sortBy: "unknownMetric" }, "sortBy"],
      [{ sortDir: "sideways" }, "sortDir"],
    ])("enforces driver list bounds", async (input, property) => {
      const { errors } = await validateQuery(StatisticsDriversQueryDto, input);
      expect(errors.some((error) => error.property === property)).toBe(true);
    });

    it("validates exception keys and severities", async () => {
      const valid = await validateQuery(StatisticsExceptionsQueryDto, {
        key: "ex_trip_missing_payout",
        severity: "HIGH",
      });
      expect(valid.errors).toHaveLength(0);

      const invalid = await validateQuery(StatisticsExceptionsQueryDto, {
        key: "missing_payout",
        severity: "CRITICAL",
      });
      expect(invalid.errors.map((error) => error.property).sort()).toEqual([
        "key",
        "severity",
      ]);
    });

    it("keeps every approved exception definition stable and non-financial", () => {
      expect(Object.keys(STATISTICS_EXCEPTION_DEFINITIONS)).toEqual([
        ...STATISTICS_EXCEPTION_KEYS,
      ]);
      const item = new StatisticsExceptionItemDto();
      for (const property of [
        "amountCents",
        "payoutCents",
        "chargeCents",
        "currency",
        "currencyGroups",
        "grossProfitCents",
        "grossMarginBasisPoints",
      ]) {
        expect(item).not.toHaveProperty(property);
      }
    });

    it("keeps finance at job grain by rejecting trip, driver, and vehicle filters", async () => {
      const { errors } = await validateQuery(StatisticsFinanceQueryDto, {
        from: "2026-07-01",
        to: "2026-07-31",
        customerId: "customer-1",
        jobId: "job-1",
        tripId: "trip-1",
        driverId: "driver-1",
        vehicleId: "vehicle-1",
      });
      expect(errors.map((error) => error.property).sort()).toEqual([
        "driverId",
        "tripId",
        "vehicleId",
      ]);
    });
  });

  describe("response money validation", () => {
    it("accepts integer cents and rejects floating-point cents", async () => {
      const valid = plainToInstance(StatisticsCurrencyAmountDto, {
        currency: "SGD",
        amountCents: 12_345,
      });
      await expect(validate(valid)).resolves.toHaveLength(0);

      const invalid = plainToInstance(StatisticsCurrencyAmountDto, {
        currency: "SGD",
        amountCents: 12.34,
      });
      const errors = await validate(invalid);
      expect(errors.some((error) => error.property === "amountCents")).toBe(
        true,
      );
    });

    it("validates Finance currency groups as integer cents and basis points", async () => {
      const finance = plainToInstance(StatisticsFinanceDto, {
        timeZone: "Asia/Singapore",
        generatedAt: new Date(),
        limitations: [],
        currencyGroups: [
          {
            currency: "SGD",
            jobChargesCents: 10_000,
            issuedInvoiceValueCents: 10_000,
            paidInvoiceValueCents: 0,
            uninvoicedReadyValueCents: 0,
            recordedTripPayoutCents: 2_500,
            attributableJobPayoutCents: 2_500,
            grossProfitCents: 7_500,
            grossMarginBasisPoints: 7_500,
          },
        ],
        exceptionCounts: {
          completedJobsMissingCharges: 0,
          completedTripsMissingPayouts: 0,
          excludedFromProfit: 0,
        },
      });
      await expect(validate(finance)).resolves.toHaveLength(0);

      finance.currencyGroups[0].grossMarginBasisPoints = 12.5;
      const errors = await validate(finance);
      expect(
        errors.some((error) => error.property === "currencyGroups"),
      ).toBe(true);
    });

    it("keeps the Transport Overview contract operational-only", () => {
      const overview = new StatisticsOverviewDto();
      expect(overview).not.toHaveProperty("currencyGroups");
      expect(overview).not.toHaveProperty("missingCostCount");
    });

    it("keeps the Transport Driver row contract operational-only", () => {
      const row = new StatisticsDriverRowDto();
      expect(row).not.toHaveProperty("currencyGroups");
      expect(row).not.toHaveProperty("recordedPayoutCents");
      expect(row).not.toHaveProperty("payoutCents");
      expect(row).not.toHaveProperty("earningsCents");
      expect(row).not.toHaveProperty("grossProfitCents");
      expect(row).not.toHaveProperty("grossMarginBasisPoints");

      const financialKeys = [
        "currencyGroups",
        "recordedPayoutCents",
        "payoutCents",
        "earningsCents",
        "amountCents",
        "jobChargesCents",
        "issuedInvoiceValueCents",
        "grossProfitCents",
        "grossMarginBasisPoints",
      ];
      for (const key of financialKeys) {
        expect(
          Object.prototype.hasOwnProperty.call(
            StatisticsDriverRowDto.prototype,
            key,
          ),
        ).toBe(false);
      }
    });
  });
});
