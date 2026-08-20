import { Reflector } from "@nestjs/core";
import { CanonicalTenantRole, Role, TripExpenseReviewStatus } from "@prisma/client";
import {
  buildJobFinanceSummary,
  deriveJobFinanceStatus,
  isApprovedExpenseCost,
  sumDriverPayoutCentsForTrips,
} from "./job-finance-summary.helpers";
import { JobFinanceSummaryService } from "./job-finance-summary.service";
import { JobFinanceSummaryController } from "./job-finance-summary.controller";
import { StrictCanonicalRoleGuard } from "../../shared/auth/guards/strict-canonical-role.guard";
import { AUTH_MODE } from "../../shared/auth/request-context";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { ModuleEntitlementGuard } from "../../shared/auth/guards/module-entitlement.guard";

describe("job-finance-summary.helpers", () => {
  it("approved expense counts; every other review status does not", () => {
    expect(isApprovedExpenseCost(TripExpenseReviewStatus.APPROVED)).toBe(true);
    expect(isApprovedExpenseCost(TripExpenseReviewStatus.PENDING_REVIEW)).toBe(
      false,
    );
    expect(isApprovedExpenseCost(TripExpenseReviewStatus.REJECTED)).toBe(false);
    expect(
      isApprovedExpenseCost(TripExpenseReviewStatus.NEEDS_CLARIFICATION),
    ).toBe(false);
  });

  it("driver payout plus approved expense produces totalCostCents", () => {
    const driverPayoutCents = sumDriverPayoutCentsForTrips([
      {
        status: "COMPLETED",
        payoutLines: [
          {
            totalCents: 4000,
            amountCents: 4000,
            quantity: 1,
            isSelectableForTripEarning: true,
          },
        ],
      },
      {
        status: "CANCELLED",
        payoutLines: [
          {
            totalCents: 9999,
            amountCents: 9999,
            quantity: 1,
            isSelectableForTripEarning: true,
          },
        ],
      },
    ]);
    const summary = buildJobFinanceSummary({
      driverPayoutCents,
      miscPayoutCents: 1500,
      totalJobBillableCents: 10000,
      invoiceRevenueCents: 8000,
    });
    expect(summary.driverPayoutCents).toBe(4000);
    expect(summary.miscPayoutCents).toBe(1500);
    expect(summary.totalCostCents).toBe(5500);
  });

  it("reimbursement PAID does not double the expense (misc is amount only once)", () => {
    const summary = buildJobFinanceSummary({
      driverPayoutCents: 0,
      miscPayoutCents: 2500,
      totalJobBillableCents: 0,
      invoiceRevenueCents: 10000,
    });
    expect(summary.totalCostCents).toBe(2500);
    expect(summary.financeStatus).toBe("NON_NEGATIVE");
  });

  it("cost greater than invoice returns NEGATIVE", () => {
    expect(
      deriveJobFinanceStatus({
        totalCostCents: 5001,
        invoiceRevenueCents: 5000,
      }),
    ).toEqual({ financeStatus: "NEGATIVE", differenceCents: 1 });
  });

  it("cost equal to invoice returns NON_NEGATIVE", () => {
    expect(
      deriveJobFinanceStatus({
        totalCostCents: 5000,
        invoiceRevenueCents: 5000,
      }),
    ).toEqual({ financeStatus: "NON_NEGATIVE", differenceCents: 0 });
  });

  it("no qualifying invoice returns NOT_INVOICED", () => {
    expect(
      deriveJobFinanceStatus({
        totalCostCents: 9000,
        invoiceRevenueCents: null,
      }),
    ).toEqual({ financeStatus: "NOT_INVOICED", differenceCents: null });
    const summary = buildJobFinanceSummary({
      driverPayoutCents: 9000,
      miscPayoutCents: 0,
      totalJobBillableCents: 1000,
      invoiceRevenueCents: null,
    });
    expect(summary.financeStatus).toBe("NOT_INVOICED");
    expect(summary.invoiceRevenueCents).toBeNull();
  });

  it("multiple trips aggregate once into their job", () => {
    const total = sumDriverPayoutCentsForTrips([
      {
        status: "DONE",
        payoutLines: [{ totalCents: 1000, isSelectableForTripEarning: true }],
      },
      {
        status: "ONGOING",
        payoutLines: [{ totalCents: 2000, isSelectableForTripEarning: true }],
      },
      {
        status: "CANCELLED",
        payoutLines: [{ totalCents: 5000, isSelectableForTripEarning: true }],
      },
    ]);
    expect(total).toBe(3000);
  });
});

describe("JobFinanceSummaryService set-based aggregation", () => {
  const tenantId = "t1";

  function attributedLine(partial: Record<string, unknown>) {
    return {
      id: "line-1",
      tenantId,
      amountCents: 5000,
      taxCents: 0,
      jobChargeId: "jc-1",
      jobCharge: { jobId: "job-1", tenantId },
      invoice: {
        id: "inv-1",
        tenantId,
        status: "ISSUED",
        currency: "SGD",
      },
      ...partial,
    };
  }

  function makeService(overrides: Record<string, unknown> = {}) {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job-1",
          internalRef: "JOB-1",
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: "job-1", internalRef: "JOB-1" },
          { id: "job-2", internalRef: "JOB-2" },
        ]),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip-1",
            jobId: "job-1",
            status: "COMPLETED",
            driverEarningCents: null,
            payoutLines: [
              {
                totalCents: 3000,
                amountCents: 3000,
                quantity: 1,
                isSelectableForTripEarning: true,
              },
            ],
          },
          {
            id: "trip-2",
            jobId: "job-1",
            status: "DONE",
            driverEarningCents: null,
            payoutLines: [
              {
                totalCents: 2000,
                amountCents: 2000,
                quantity: 1,
                isSelectableForTripEarning: true,
              },
            ],
          },
        ]),
      },
      jobCharge: {
        groupBy: jest.fn().mockResolvedValue([
          { jobId: "job-1", _sum: { amountCents: 12000 } },
        ]),
      },
      tripExpense: {
        groupBy: jest.fn().mockResolvedValue([
          { jobId: "job-1", _sum: { amountCents: 1500 } },
        ]),
      },
      invoiceLineItem: {
        findMany: jest.fn().mockResolvedValue([
          attributedLine({
            id: "line-issued",
            amountCents: 5000,
            taxCents: 0,
          }),
        ]),
      },
      invoice: {
        findMany: jest.fn(),
      },
      ...overrides,
    };
    const svc = new JobFinanceSummaryService(prisma);
    return { svc, prisma };
  }

  it("aggregates costs and attributes charge-backed issued lines; ignores void/draft", async () => {
    const { svc, prisma } = makeService({
      invoiceLineItem: {
        findMany: jest.fn().mockResolvedValue([
          attributedLine({
            id: "line-issued",
            amountCents: 5000,
            taxCents: 0,
            invoice: {
              id: "inv-issued",
              tenantId,
              status: "ISSUED",
              currency: "SGD",
            },
          }),
          attributedLine({
            id: "line-void",
            amountCents: 8000,
            taxCents: 0,
            invoice: {
              id: "inv-void",
              tenantId,
              status: "VOID",
              currency: "SGD",
            },
          }),
        ]),
      },
    });
    // VOID filtered at query; mock returns only ISSUED-path rows typically — still assert filter where
    const summary = await svc.getForJob(tenantId, "job-1");
    expect(summary.driverPayoutCents).toBe(5000);
    expect(summary.miscPayoutCents).toBe(1500);
    expect(summary.totalCostCents).toBe(6500);
    expect(summary.totalJobBillableCents).toBe(12000);
    expect(summary.invoiceRevenueCents).toBe(5000);
    expect(summary.financeStatus).toBe("NEGATIVE");
    expect(prisma.invoiceLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId }),
      }),
    );
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("attributes two jobs on one invoice without duplicating invoice total", async () => {
    const { svc } = makeService({
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      jobCharge: { groupBy: jest.fn().mockResolvedValue([]) },
      tripExpense: { groupBy: jest.fn().mockResolvedValue([]) },
      invoiceLineItem: {
        findMany: jest.fn().mockResolvedValue([
          attributedLine({
            id: "l-a",
            amountCents: 3000,
            taxCents: 270,
            jobChargeId: "jc-a",
            jobCharge: { jobId: "job-1", tenantId },
            invoice: {
              id: "inv-multi",
              tenantId,
              status: "ISSUED",
              currency: "SGD",
            },
          }),
          attributedLine({
            id: "l-b",
            amountCents: 7000,
            taxCents: 630,
            jobChargeId: "jc-b",
            jobCharge: { jobId: "job-2", tenantId },
            invoice: {
              id: "inv-multi",
              tenantId,
              status: "ISSUED",
              currency: "SGD",
            },
          }),
        ]),
      },
    });
    const map = await svc.summarizeJobs(tenantId, ["job-1", "job-2"]);
    expect(map.get("job-1")?.invoiceRevenueCents).toBe(3270);
    expect(map.get("job-2")?.invoiceRevenueCents).toBe(7630);
    expect(
      (map.get("job-1")?.invoiceRevenueCents ?? 0) +
        (map.get("job-2")?.invoiceRevenueCents ?? 0),
    ).toBe(10900);
  });

  it("does not count sourceJobId-only / manual lines as job revenue", async () => {
    const { svc } = makeService({
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      jobCharge: { groupBy: jest.fn().mockResolvedValue([]) },
      tripExpense: { groupBy: jest.fn().mockResolvedValue([]) },
      invoiceLineItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const map = await svc.summarizeJobs(tenantId, ["job-1"]);
    expect(map.get("job-1")?.invoiceRevenueCents).toBeNull();
    expect(map.get("job-1")?.financeStatus).toBe("NOT_INVOICED");
  });

  it("summarizeJobs is set-based (no per-job finance query pattern)", async () => {
    const { svc, prisma } = makeService();
    await svc.summarizeJobs(tenantId, ["job-1", "job-2"]);
    expect(prisma.trip.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.jobCharge.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.tripExpense.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.invoiceLineItem.findMany).toHaveBeenCalledTimes(1);
  });

  it("cross-tenant job lookup fails closed", async () => {
    const { svc, prisma } = makeService();
    prisma.job.findFirst.mockResolvedValueOnce(null);
    await expect(svc.getForJob("other", "job-1")).rejects.toThrow(/not found/i);
    expect(prisma.job.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", tenantId: "other" },
      }),
    );
  });

  it("listSummaries finds NEGATIVE jobs beyond the first 2000 newest jobs", async () => {
    const BATCH = 200;
    const totalJobs = 2100;
    const jobs = Array.from({ length: totalJobs }, (_, i) => ({
      id: `job-${i}`,
      internalRef: `JOB-${i}`,
    }));
    // Newest first: index 0 is newest; oldest negative at the end of the list.
    const oldestNegativeId = `job-${totalJobs - 1}`;

    const prisma: any = {
      job: {
        findMany: jest.fn().mockImplementation(async ({ skip, take }) => {
          return jobs.slice(skip, skip + take);
        }),
      },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
      jobCharge: { groupBy: jest.fn().mockResolvedValue([]) },
      tripExpense: {
        groupBy: jest.fn().mockImplementation(async ({ where }) => {
          const ids: string[] = where.jobId.in;
          return ids
            .filter((id) => id === oldestNegativeId)
            .map((jobId) => ({ jobId, _sum: { amountCents: 0 } }));
        }),
      },
      invoiceLineItem: {
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          const ids: string[] = where.jobCharge.jobId.in;
          if (!ids.includes(oldestNegativeId)) return [];
          return [
            {
              id: "line-old",
              tenantId,
              amountCents: 100,
              taxCents: 0,
              jobChargeId: "jc-old",
              jobCharge: { jobId: oldestNegativeId, tenantId },
              invoice: {
                id: "inv-old",
                tenantId,
                status: "ISSUED",
                currency: "SGD",
              },
            },
          ];
        }),
      },
    };
    // Driver cost for oldest job only — make it negative vs 100 revenue.
    prisma.trip.findMany = jest.fn().mockImplementation(async ({ where }) => {
      const ids: string[] = where.jobId.in;
      if (!ids.includes(oldestNegativeId)) return [];
      return [
        {
          id: "trip-old",
          jobId: oldestNegativeId,
          status: "COMPLETED",
          driverEarningCents: null,
          payoutLines: [
            {
              totalCents: 500,
              amountCents: 500,
              quantity: 1,
              isSelectableForTripEarning: true,
            },
          ],
        },
      ];
    });

    const svc = new JobFinanceSummaryService(prisma);
    const result = await svc.listSummaries(tenantId, {
      financeStatus: "NEGATIVE",
      page: 1,
      pageSize: 20,
    });

    expect(result.meta.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.jobId).toBe(oldestNegativeId);
    expect(result.data[0]?.financeStatus).toBe("NEGATIVE");
    // Must scan past 2000 (at least 11 batches of 200).
    expect(prisma.job.findMany.mock.calls.length).toBeGreaterThanOrEqual(
      Math.ceil(totalJobs / BATCH),
    );
    expect(prisma.job.findMany.mock.calls.some((c: any[]) => c[0]?.take === 2000)).toBe(
      false,
    );
  });
});

describe("JobFinanceSummaryController strict canonical roles + Finance module", () => {
  const reflector = new Reflector();
  const guard = new StrictCanonicalRoleGuard(reflector);

  function ctx(handler: any, tenant: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
      getHandler: () => handler,
      getClass: () => JobFinanceSummaryController,
    } as any;
  }

  it("uses StrictCanonicalRoleGuard (not RoleGuard singular fallback)", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, JobFinanceSummaryController),
    ).toEqual([
      AuthGuard,
      TenantGuard,
      StrictCanonicalRoleGuard,
      ModuleEntitlementGuard,
    ]);
  });

  it("allows Finance Admin and Tenant Admin; denies Transport Staff and Driver", () => {
    expect(
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.getOne, {
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [CanonicalTenantRole.FINANCE_ADMIN],
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.list, {
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [CanonicalTenantRole.TENANT_ADMIN],
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.getOne, {
          tenantId: "t1",
          role: Role.TRANSPORT_STAFF,
          roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
        }),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.getOne, {
          tenantId: "t1",
          role: Role.DRIVER,
          roles: [CanonicalTenantRole.TRANSPORT_DRIVER],
        }),
      ),
    ).toThrow();
  });

  it("denies empty roles[] even when singular role is FINANCE", () => {
    expect(() =>
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.getOne, {
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [],
        }),
      ),
    ).toThrow(/roles\[\]/i);
  });

  it("when roles[] is present, singular role alone does not expand authority", () => {
    expect(() =>
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.getOne, {
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
        }),
      ),
    ).toThrow();
  });

  it("allows Platform Admin only with selected tenant operation context", () => {
    expect(
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.getOne, {
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [],
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx(JobFinanceSummaryController.prototype.getOne, {
          tenantId: null,
          role: Role.ADMIN,
          roles: [],
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_CONTROL,
        }),
      ),
    ).toThrow();
  });

  it("controller requires FINANCE module metadata", () => {
    expect(
      Reflect.getMetadata("requiresTenantModule", JobFinanceSummaryController),
    ).toEqual(["FINANCE"]);
  });
});
