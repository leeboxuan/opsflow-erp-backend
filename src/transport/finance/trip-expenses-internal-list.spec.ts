import { ForbiddenException } from "@nestjs/common";
import {
  CanonicalTenantRole,
  TripExpenseReviewStatus,
} from "@prisma/client";
import { TripExpensesService } from "./trip-expenses.service";
import { expenseCountsTowardJobCost } from "./trip-expense.rules";

describe("TripExpensesService listForInternalTrip", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";

  function makeSvc(rows: any[] = []) {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: tripId, jobId }),
      },
      tripExpense: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
      tripExpenseAttachment: {
        findFirst: jest.fn(),
      },
    };
    const svc = new TripExpensesService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
      { begin: jest.fn(), complete: jest.fn() } as any,
    );
    return { svc, prisma };
  }

  it("allows internal viewers and totals submitted vs approved without double-counting", async () => {
    const { svc } = makeSvc([
      {
        id: "e1",
        tenantId,
        jobId,
        tripId,
        amountCents: 1000,
        currency: "SGD",
        reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
        reimbursementStatus: "PENDING",
        category: "PARKING",
        paymentMethod: "DRIVER_PAID",
        transactionDate: new Date("2026-08-01"),
        remarks: null,
        attachments: [],
        submittedByUser: { name: "Driver A" },
        job: { internalRef: "J1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "e2",
        tenantId,
        jobId,
        tripId,
        amountCents: 2500,
        currency: "SGD",
        reviewStatus: TripExpenseReviewStatus.APPROVED,
        reimbursementStatus: "PAID",
        category: "TOLLS",
        paymentMethod: "DRIVER_PAID",
        transactionDate: new Date("2026-08-02"),
        remarks: "ERP",
        attachments: [{ id: "a1", originalName: "r.jpg", mimeType: "image/jpeg", isActive: true }],
        submittedByUser: { name: "Driver A" },
        job: { internalRef: "J1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "e3",
        tenantId,
        jobId,
        tripId,
        amountCents: 500,
        currency: "SGD",
        reviewStatus: TripExpenseReviewStatus.REJECTED,
        reimbursementStatus: "NOT_REQUIRED",
        category: "OTHER",
        paymentMethod: "COMPANY_CARD",
        transactionDate: new Date("2026-08-03"),
        remarks: null,
        attachments: [],
        submittedByUser: { name: "Driver A" },
        job: { internalRef: "J1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await svc.listForInternalTrip(tenantId, jobId, tripId, {
      roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
      userId: "ops-1",
    });

    expect(result.data).toHaveLength(3);
    expect(result.totals.submittedCents).toBe(4000);
    expect(result.totals.approvedCents).toBe(2500);
    expect(result.data.every((row: any) => !("storageKey" in (row.attachments?.[0] ?? {})))).toBe(
      true,
    );
    expect(
      expenseCountsTowardJobCost({
        reviewStatus: TripExpenseReviewStatus.APPROVED,
      }),
    ).toBe(true);
    expect(
      expenseCountsTowardJobCost({
        reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      }),
    ).toBe(false);
  });

  it("rejects customer and driver actors closed", async () => {
    const { svc } = makeSvc();
    await expect(
      svc.listForInternalTrip(tenantId, jobId, tripId, {
        roles: [CanonicalTenantRole.CUSTOMER_ADMIN],
        userId: "cust-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      svc.listForInternalTrip(tenantId, jobId, tripId, {
        roles: [CanonicalTenantRole.TRANSPORT_DRIVER],
        userId: "drv-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("TripExpensesService createForOps", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const OP_KEY = "33333333-3333-4333-8333-333333333333";

  function makeSvc() {
    const expenseStore: any[] = [];
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: tripId, jobId }),
      },
      tripExpense: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const hit = expenseStore.find(
            (e) => e.id === where.id && e.tenantId === where.tenantId,
          );
          return Promise.resolve(hit ?? null);
        }),
        findFirstOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
          const hit = expenseStore.find((e) => e.id === where.id);
          if (!hit) throw new Error("missing");
          return hit;
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = {
            id: "exp-ops-1",
            ...data,
            attachments: [],
            job: { internalRef: "JOB-1" },
            submittedByUser: { name: "Ops" },
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          expenseStore.push(row);
          return Promise.resolve(row);
        }),
      },
      tripExpenseAttachment: { create: jest.fn() },
      tripExpenseEvent: { create: jest.fn() },
    };
    const idempotency = {
      peekCompleted: jest.fn().mockResolvedValue(null),
      execute: jest.fn(async (params: any) => {
        const out = await params.execute(prisma);
        return { result: out.result, outcome: "created" as const };
      }),
    };
    const svc = new TripExpensesService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
      idempotency as any,
    );
    return { svc, prisma, idempotency };
  }

  it("allows transport ops to create and rejects finance-only / driver / customer", async () => {
    const { svc, prisma } = makeSvc();
    const created = await svc.createForOps(
      tenantId,
      jobId,
      tripId,
      { roles: [CanonicalTenantRole.TRANSPORT_ADMIN], userId: "ops-1" },
      {
        category: "PARKING" as any,
        paymentMethod: "DRIVER_PAID" as any,
        amountCents: 800,
        transactionDate: "2026-09-04",
        operationKey: OP_KEY,
      },
    );
    expect(created.amountCents).toBe(800);
    expect(prisma.tripExpense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          submittedByUserId: "ops-1",
          submittedByDriverId: null,
        }),
      }),
    );

    await expect(
      svc.createForOps(
        tenantId,
        jobId,
        tripId,
        { roles: [CanonicalTenantRole.FINANCE_ADMIN], userId: "fin-1" },
        {
          category: "PARKING" as any,
          paymentMethod: "DRIVER_PAID" as any,
          amountCents: 800,
          transactionDate: "2026-09-04",
          operationKey: OP_KEY,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      svc.createForOps(
        tenantId,
        jobId,
        tripId,
        { roles: [CanonicalTenantRole.TRANSPORT_DRIVER], userId: "drv-1" },
        {
          category: "PARKING" as any,
          paymentMethod: "DRIVER_PAID" as any,
          amountCents: 800,
          transactionDate: "2026-09-04",
          operationKey: OP_KEY,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
