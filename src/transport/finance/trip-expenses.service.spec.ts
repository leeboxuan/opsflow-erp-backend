import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  TripExpenseCategory,
  TripExpenseEventAction,
  TripExpensePaymentMethod,
  TripExpenseReimbursementStatus,
  TripExpenseReviewStatus,
  TripStatus,
} from "@prisma/client";
import { Reflector } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { CanonicalTenantRole, Role } from "@prisma/client";
import { TripExpensesService } from "./trip-expenses.service";
import { TripExpensesController } from "./trip-expenses.controller";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { AUTH_MODE } from "../../shared/auth/request-context";
import {
  ApproveTripExpenseDto,
  RejectTripExpenseDto,
  RequestTripExpenseClarificationDto,
} from "./dto/trip-expense.dto";

const OP_KEY_A = "11111111-1111-4111-8111-111111111111";
const OP_KEY_B = "22222222-2222-4222-8222-222222222222";

describe("TripExpensesService authorization and transitions", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-user-1";

  function makeSvc(overrides?: {
    trip?: any;
    expense?: any;
    auditLog?: jest.Mock;
  }) {
    const expenseStore: any[] = [];
    const now = new Date("2026-08-20T10:00:00.000Z");

    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue(
          overrides?.trip === undefined
            ? {
                id: tripId,
                jobId,
                status: TripStatus.ONGOING,
                assignedDriverUserId: driverUserId,
              }
            : overrides.trip,
        ),
      },
      drivers: {
        findFirst: jest.fn().mockResolvedValue({ id: "driver-row-1" }),
      },
      tripExpense: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (overrides?.expense) return Promise.resolve(overrides.expense);
          const hit = expenseStore.find(
            (e) =>
              e.id === where.id &&
              e.tenantId === where.tenantId &&
              (!where.submittedByUserId ||
                e.submittedByUserId === where.submittedByUserId),
          );
          return Promise.resolve(hit ?? null);
        }),
        findFirstOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
          const hit = await prisma.tripExpense.findFirst({ where });
          if (!hit) throw new Error("missing");
          return hit;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = {
            id: `exp-${expenseStore.length + 1}`,
            ...data,
            createdAt: now,
            updatedAt: now,
            attachments: [],
            job: { internalRef: "JOB-1" },
            submittedByUser: { name: "Driver" },
          };
          expenseStore.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
          const row =
            expenseStore.find((e) => e.id === where.id) ??
            (overrides?.expense && overrides.expense.id === where.id
              ? overrides.expense
              : null);
          if (!row) return Promise.resolve({ count: 0 });
          if (where.tenantId && row.tenantId !== where.tenantId) {
            return Promise.resolve({ count: 0 });
          }
          if (where.reviewStatus && row.reviewStatus !== where.reviewStatus) {
            return Promise.resolve({ count: 0 });
          }
          if (
            where.reimbursementStatus &&
            row.reimbursementStatus !== where.reimbursementStatus
          ) {
            return Promise.resolve({ count: 0 });
          }
          if (
            where.submittedByUserId &&
            row.submittedByUserId !== where.submittedByUserId
          ) {
            return Promise.resolve({ count: 0 });
          }
          if (
            where.updatedAt &&
            row.updatedAt?.getTime?.() !== where.updatedAt?.getTime?.()
          ) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(row, data, { updatedAt: new Date(now.getTime() + 1000) });
          row.attachments = row.attachments ?? [{ id: "att-1", isActive: true }];
          row.job = { internalRef: "JOB-1" };
          row.submittedByUser = { name: "Driver" };
          if (overrides?.expense) Object.assign(overrides.expense, row);
          return Promise.resolve({ count: 1 });
        }),
      },
      tripExpenseAttachment: {
        create: jest.fn().mockResolvedValue({
          id: "att-1",
          originalName: "receipt.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 12,
          createdAt: now,
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      tripExpenseEvent: {
        create: jest.fn().mockResolvedValue({ id: "evt-1" }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      getClient: () => ({
        storage: {
          from: () => ({
            upload,
            remove,
            createSignedUrl: jest
              .fn()
              .mockResolvedValue({ data: { signedUrl: "https://signed" } }),
          }),
        },
      }),
    };

    const idempotency = {
      peekCompleted: jest.fn().mockResolvedValue(null),
      execute: jest.fn(async (params: any) => {
        const out = await params.execute(prisma);
        return { result: out.result, outcome: "created" as const };
      }),
    };

    const auditLog = overrides?.auditLog ?? jest.fn().mockResolvedValue(undefined);
    const svc = new TripExpensesService(
      prisma,
      { log: auditLog } as any,
      supabase as any,
      idempotency as any,
    );
    return { svc, prisma, idempotency, upload, remove, auditLog, expenseStore };
  }

  function pendingExpense(extra?: Record<string, unknown>) {
    return {
      id: "exp-1",
      tenantId,
      jobId,
      tripId,
      submittedByUserId: driverUserId,
      reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      amountCents: 1000,
      currency: "SGD",
      category: TripExpenseCategory.PARKING,
      transactionDate: new Date("2026-08-20"),
      remarks: null,
      reviewReason: null,
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      attachments: [{ id: "a1", isActive: true }],
      ...extra,
    };
  }

  it("rejects unassigned driver create", async () => {
    const { svc } = makeSvc({ trip: null });
    await expect(
      svc.createForDriver(tenantId, jobId, tripId, driverUserId, {
        category: TripExpenseCategory.PARKING,
        paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
        amountCents: 500,
        transactionDate: "2026-08-20",
        operationKey: OP_KEY_A,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects missing operationKey", async () => {
    const { svc } = makeSvc();
    await expect(
      svc.createForDriver(tenantId, jobId, tripId, driverUserId, {
        category: TripExpenseCategory.PARKING,
        paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
        amountCents: 500,
        transactionDate: "2026-08-20",
        operationKey: "",
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates DRIVER_PAID with PENDING reimbursement via idempotent path", async () => {
    const { svc, prisma, idempotency } = makeSvc();
    const created = await svc.createForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      {
        category: TripExpenseCategory.PARKING,
        paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
        amountCents: 1250,
        currency: "SGD",
        transactionDate: "2026-08-20",
        operationKey: OP_KEY_A,
      },
    );
    expect(idempotency.peekCompleted).toHaveBeenCalled();
    expect(idempotency.execute).toHaveBeenCalled();
    expect(prisma.tripExpense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 1250,
          reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
          reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
        }),
      }),
    );
    expect(created.amountCents).toBe(1250);
  });

  it("allows two same-day same-category same-amount expenses with different operation keys", async () => {
    const { svc, prisma } = makeSvc();
    const payload = {
      category: TripExpenseCategory.PARKING,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      amountCents: 500,
      currency: "SGD",
      transactionDate: "2026-08-20",
    };
    const first = await svc.createForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      { ...payload, operationKey: OP_KEY_A },
    );
    const second = await svc.createForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      { ...payload, operationKey: OP_KEY_B },
    );
    expect(first.id).not.toBe(second.id);
    expect(prisma.tripExpense.create).toHaveBeenCalledTimes(2);
  });

  it("rejects zero/invalid amounts", async () => {
    const { svc } = makeSvc();
    await expect(
      svc.createForDriver(tenantId, jobId, tripId, driverUserId, {
        category: TripExpenseCategory.FUEL,
        paymentMethod: TripExpensePaymentMethod.COMPANY_EPAYMENT,
        amountCents: 0,
        transactionDate: "2026-08-20",
        operationKey: OP_KEY_A,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires clarification/rejection reason and blocks invalid transitions", async () => {
    const { svc } = makeSvc({ expense: pendingExpense() });
    await expect(
      svc.reject(tenantId, "exp-1", "fin-1", { reason: "" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.requestClarification(tenantId, "exp-1", "fin-1", {
        reason: "Need clearer photo",
      }),
    ).resolves.toMatchObject({
      reviewStatus: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
    });
  });

  it("approves with receipt and marks reimbursement paid without changing amount", async () => {
    const approvedBase = pendingExpense({
      amountCents: 2500,
      category: TripExpenseCategory.TOLL,
    });
    const { svc, prisma } = makeSvc({ expense: approvedBase });
    const approved = await svc.approve(tenantId, "exp-1", "fin-1", {});
    expect(approved.reviewStatus).toBe(TripExpenseReviewStatus.APPROVED);

    Object.assign(approvedBase, {
      reviewStatus: TripExpenseReviewStatus.APPROVED,
      updatedAt: new Date("2026-08-20T10:00:01.000Z"),
    });
    prisma.tripExpense.findFirst.mockResolvedValue(approvedBase);
    const paid = await svc.markReimbursementPaid(tenantId, "exp-1", "fin-1");
    expect(paid.reimbursementStatus).toBe(TripExpenseReimbursementStatus.PAID);
    expect(prisma.tripExpense.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reimbursementStatus: TripExpenseReimbursementStatus.PAID,
        }),
      }),
    );
  });

  it("creates REVIEWER_CORRECTED then APPROVED events when approving with corrections", async () => {
    const { svc, prisma } = makeSvc({ expense: pendingExpense() });
    await svc.approve(tenantId, "exp-1", "fin-1", {
      amountCents: 1500,
      note: "Rounded",
    });
    const actions = prisma.tripExpenseEvent.create.mock.calls.map(
      (c: any) => c[0].data.action,
    );
    expect(actions).toEqual([
      TripExpenseEventAction.REVIEWER_CORRECTED,
      TripExpenseEventAction.APPROVED,
    ]);
  });

  it("blocks driver update of APPROVED expense", async () => {
    const { svc } = makeSvc({
      expense: pendingExpense({
        reviewStatus: TripExpenseReviewStatus.APPROVED,
      }),
    });
    await expect(
      svc.updateForDriver(tenantId, "exp-1", driverUserId, {
        remarks: "x",
        operationKey: OP_KEY_A,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("TripExpensesService storage-safe idempotency", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-user-1";
  const file = {
    buffer: Buffer.from("receipt"),
    originalname: "receipt.jpg",
    mimetype: "image/jpeg",
    size: 7,
  } as Express.Multer.File;

  function makeStorageSvc() {
    const now = new Date("2026-08-20T10:00:00.000Z");
    const expenseStore: any[] = [];
    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });

    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          jobId,
          status: TripStatus.ONGOING,
          assignedDriverUserId: driverUserId,
        }),
      },
      drivers: {
        findFirst: jest.fn().mockResolvedValue({ id: "driver-row-1" }),
      },
      tripExpense: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const hit = expenseStore.find((e) => e.id === where.id);
          return Promise.resolve(hit ?? null);
        }),
        findFirstOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
          const hit = expenseStore.find((e) => e.id === where.id);
          if (!hit) throw new Error("missing");
          return hit;
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = {
            id: "exp-1",
            ...data,
            createdAt: now,
            updatedAt: now,
            attachments: [],
            job: { internalRef: "JOB-1" },
            submittedByUser: { name: "Driver" },
          };
          expenseStore.push(row);
          return Promise.resolve(row);
        }),
      },
      tripExpenseAttachment: {
        create: jest.fn().mockResolvedValue({
          id: "att-1",
          originalName: "receipt.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 7,
          createdAt: now,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "att-1",
          originalName: "receipt.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 7,
          createdAt: now,
        }),
      },
      tripExpenseEvent: {
        create: jest.fn().mockResolvedValue({ id: "evt-1" }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const idempotency = {
      peekCompleted: jest.fn().mockResolvedValue(null),
      execute: jest.fn(async (params: any) => {
        const out = await params.execute(prisma);
        return { result: out.result, outcome: "created" as const };
      }) as jest.Mock,
    };

    const svc = new TripExpensesService(
      prisma,
      { log: jest.fn() } as any,
      {
        getClient: () => ({
          storage: { from: () => ({ upload, remove }) },
        }),
      } as any,
      idempotency as any,
    );
    return { svc, prisma, idempotency, upload, remove, expenseStore };
  }

  it("first request uploads once; replay peeks and skips upload", async () => {
    const { svc, idempotency, upload, remove } = makeStorageSvc();
    const dto = {
      category: TripExpenseCategory.PARKING,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      amountCents: 500,
      transactionDate: "2026-08-20",
      operationKey: OP_KEY_A,
    };

    await svc.createForDriver(tenantId, jobId, tripId, driverUserId, dto, file);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(0);

    idempotency.peekCompleted.mockResolvedValueOnce({
      outcome: "replayed" as const,
      result: { id: "exp-1", amountCents: 500 },
    });
    await svc.createForDriver(tenantId, jobId, tripId, driverUserId, dto, file);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(0);
    expect(idempotency.execute).toHaveBeenCalledTimes(1);
  });

  it("hash conflict peeks before upload and does not upload", async () => {
    const { svc, idempotency, upload, remove } = makeStorageSvc();
    idempotency.peekCompleted.mockRejectedValueOnce(
      new ConflictException({
        message: "Operation key reused with a different payload",
        code: "IDEMPOTENCY_KEY_CONFLICT",
      }),
    );
    await expect(
      svc.createForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        {
          category: TripExpenseCategory.PARKING,
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          amountCents: 500,
          transactionDate: "2026-08-20",
          operationKey: OP_KEY_A,
        },
        file,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes uploaded object when execute reports replayed", async () => {
    const { svc, idempotency, upload, remove } = makeStorageSvc();
    idempotency.execute.mockResolvedValueOnce({
      outcome: "replayed" as const,
      result: { id: "exp-existing", amountCents: 500 },
    });

    await svc.createForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      {
        category: TripExpenseCategory.PARKING,
        paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
        amountCents: 500,
        transactionDate: "2026-08-20",
        operationKey: OP_KEY_A,
      },
      file,
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("cleans up storage when DB execute fails after upload", async () => {
    const { svc, idempotency, upload, remove } = makeStorageSvc();
    idempotency.execute.mockRejectedValueOnce(new Error("db down"));
    await expect(
      svc.createForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        {
          category: TripExpenseCategory.PARKING,
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          amountCents: 500,
          transactionDate: "2026-08-20",
          operationKey: OP_KEY_A,
        },
        file,
      ),
    ).rejects.toThrow("db down");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("logs cleanup failure without masking DB error", async () => {
    const { svc, idempotency, upload, remove } = makeStorageSvc();
    remove.mockResolvedValueOnce({ error: { message: "remove failed" } });
    idempotency.execute.mockRejectedValueOnce(new Error("unique constraint"));
    const errorSpy = jest
      .spyOn((svc as any).logger, "error")
      .mockImplementation(() => undefined);

    await expect(
      svc.createForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        {
          category: TripExpenseCategory.PARKING,
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          amountCents: 500,
          transactionDate: "2026-08-20",
          operationKey: OP_KEY_A,
        },
        file,
      ),
    ).rejects.toThrow("unique constraint");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("TripExpensesService concurrency-safe transitions", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-user-1";

  function baseExpense(extra?: Record<string, unknown>) {
    return {
      id: "exp-1",
      tenantId,
      jobId,
      tripId,
      submittedByUserId: driverUserId,
      reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      amountCents: 1000,
      currency: "SGD",
      category: TripExpenseCategory.PARKING,
      transactionDate: new Date("2026-08-20"),
      remarks: null,
      reviewReason: null,
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      attachments: [{ id: "a1", isActive: true }],
      ...extra,
    };
  }

  function makeConcurrentSvc(expense: any) {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          jobId,
          status: TripStatus.ONGOING,
          assignedDriverUserId: driverUserId,
        }),
      },
      drivers: { findFirst: jest.fn().mockResolvedValue({ id: "d1" }) },
      tripExpense: {
        findFirst: jest.fn().mockResolvedValue(expense),
        findFirstOrThrow: jest.fn().mockResolvedValue(expense),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      tripExpenseEvent: {
        create: jest.fn().mockResolvedValue({ id: "evt" }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
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
      { getClient: () => ({ storage: { from: () => ({}) } }) } as any,
      idempotency as any,
    );
    return { svc, prisma, idempotency };
  }

  it("driver update racing with approval returns conflict", async () => {
    const expense = baseExpense();
    const { svc, prisma } = makeConcurrentSvc(expense);
    // CAS fails because reviewer already changed status/updatedAt
    prisma.tripExpense.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.updateForDriver(tenantId, "exp-1", driverUserId, {
        remarks: "still editing",
        operationKey: OP_KEY_A,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tripExpenseEvent.create).not.toHaveBeenCalled();
  });

  it("approve racing with reject: only one succeeds", async () => {
    const expense = baseExpense();
    const { svc, prisma } = makeConcurrentSvc(expense);
    prisma.tripExpense.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.tripExpense.findFirstOrThrow.mockResolvedValue({
      ...expense,
      reviewStatus: TripExpenseReviewStatus.APPROVED,
      job: { internalRef: "JOB-1" },
      submittedByUser: { name: "Driver" },
      attachments: expense.attachments,
    });

    await expect(
      svc.approve(tenantId, "exp-1", "fin-1", {}),
    ).resolves.toMatchObject({
      reviewStatus: TripExpenseReviewStatus.APPROVED,
    });
    await expect(
      svc.reject(tenantId, "exp-1", "fin-2", { reason: "too late" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("duplicate approval returns conflict and creates no second event", async () => {
    const expense = baseExpense();
    const { svc, prisma } = makeConcurrentSvc(expense);
    prisma.tripExpense.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.approve(tenantId, "exp-1", "fin-1", {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tripExpenseEvent.create).not.toHaveBeenCalled();
  });

  it("concurrent reimbursement mark-paid: second request conflicts", async () => {
    const expense = baseExpense({
      reviewStatus: TripExpenseReviewStatus.APPROVED,
    });
    const { svc, prisma } = makeConcurrentSvc(expense);
    prisma.tripExpense.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.tripExpense.findFirstOrThrow.mockResolvedValue({
      ...expense,
      reimbursementStatus: TripExpenseReimbursementStatus.PAID,
      job: { internalRef: "JOB-1" },
      submittedByUser: { name: "Driver" },
      attachments: expense.attachments,
    });

    await expect(
      svc.markReimbursementPaid(tenantId, "exp-1", "fin-1"),
    ).resolves.toMatchObject({
      reimbursementStatus: TripExpenseReimbursementStatus.PAID,
    });
    await expect(
      svc.markReimbursementPaid(tenantId, "exp-1", "fin-2"),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("TripExpensesService post-commit audit failure", () => {
  it("returns success when AuditService.log throws after approval", async () => {
    const tenantId = "t1";
    const expense = {
      id: "exp-1",
      tenantId,
      jobId: "job1",
      tripId: "trip1",
      submittedByUserId: "driver-user-1",
      reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      amountCents: 1000,
      currency: "SGD",
      category: TripExpenseCategory.PARKING,
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      attachments: [{ id: "a1", isActive: true }],
    };
    const auditLog = jest.fn().mockRejectedValue(new Error("audit down"));
    const prisma: any = {
      tripExpense: {
        findFirst: jest.fn().mockResolvedValue(expense),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          ...expense,
          reviewStatus: TripExpenseReviewStatus.APPROVED,
          job: { internalRef: "JOB-1" },
          submittedByUser: { name: "Driver" },
          attachments: expense.attachments,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tripExpenseEvent: {
        create: jest.fn().mockResolvedValue({ id: "evt-1" }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const svc = new TripExpensesService(
      prisma,
      { log: auditLog } as any,
      { getClient: () => ({}) } as any,
      { peekCompleted: jest.fn(), execute: jest.fn() } as any,
    );
    const errorSpy = jest
      .spyOn((svc as any).logger, "error")
      .mockImplementation(() => undefined);

    await expect(
      svc.approve(tenantId, "exp-1", "fin-1", {}),
    ).resolves.toMatchObject({
      reviewStatus: TripExpenseReviewStatus.APPROVED,
    });
    expect(prisma.tripExpenseEvent.create).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Post-commit audit log failed"),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });
});

describe("Trip expense review DTO whitelist", () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it("rejects financial fields on RejectTripExpenseDto", async () => {
    await expect(
      pipe.transform(
        { reason: "No", amountCents: 100, category: "PARKING" },
        { type: "body", metatype: RejectTripExpenseDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects financial fields on RequestTripExpenseClarificationDto", async () => {
    await expect(
      pipe.transform(
        {
          reason: "Blurry",
          paymentMethod: "DRIVER_PAID",
          currency: "SGD",
          reimbursementStatus: "PENDING",
        },
        { type: "body", metatype: RequestTripExpenseClarificationDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts optional corrections on ApproveTripExpenseDto", async () => {
    const dto = await pipe.transform(
      {
        note: "ok",
        amountCents: 1200,
        category: TripExpenseCategory.TOLL,
        paymentMethod: TripExpensePaymentMethod.COMPANY_CASH,
      },
      { type: "body", metatype: ApproveTripExpenseDto },
    );
    expect(dto).toMatchObject({
      note: "ok",
      amountCents: 1200,
      category: TripExpenseCategory.TOLL,
    });
  });

  it("rejects unknown fields on ApproveTripExpenseDto", async () => {
    await expect(
      pipe.transform(
        { note: "ok", currency: "SGD" },
        { type: "body", metatype: ApproveTripExpenseDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("TripExpensesController Roles + Finance module", () => {
  const reflector = new Reflector();
  const guard = new RoleGuard(reflector);

  function ctx(handler: any, tenant: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
      getHandler: () => handler,
      getClass: () => TripExpensesController,
    } as any;
  }

  it("allows Tenant Admin and Finance Admin; denies Transport Staff and Driver", () => {
    expect(
      guard.canActivate(
        ctx(TripExpensesController.prototype.list, {
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [CanonicalTenantRole.TENANT_ADMIN],
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        ctx(TripExpensesController.prototype.list, {
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [CanonicalTenantRole.FINANCE_ADMIN],
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx(TripExpensesController.prototype.list, {
          tenantId: "t1",
          role: Role.TRANSPORT_STAFF,
          roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
        }),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(
        ctx(TripExpensesController.prototype.list, {
          tenantId: "t1",
          role: Role.DRIVER,
          roles: [CanonicalTenantRole.TRANSPORT_DRIVER],
        }),
      ),
    ).toThrow();
  });

  it("allows Platform Admin with selected tenant operation context", () => {
    expect(
      guard.canActivate(
        ctx(TripExpensesController.prototype.approve, {
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [CanonicalTenantRole.TENANT_ADMIN],
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        }),
      ),
    ).toBe(true);
  });

  it("controller requires FINANCE module metadata", () => {
    expect(
      Reflect.getMetadata("requiresTenantModule", TripExpensesController),
    ).toEqual(["FINANCE"]);
  });
});

describe("TripExpensesService stable resubmit hash + receipt digest", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-user-1";
  const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function makeUpdateSvc(expense: any) {
    const eventCreates: any[] = [];
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          jobId,
          status: TripStatus.ONGOING,
          assignedDriverUserId: driverUserId,
        }),
      },
      drivers: { findFirst: jest.fn().mockResolvedValue({ id: "d1" }) },
      tripExpense: {
        findFirst: jest.fn().mockResolvedValue(expense),
        findFirstOrThrow: jest.fn().mockImplementation(async () => ({
          ...expense,
          reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
          job: { internalRef: "JOB-1" },
          submittedByUser: { name: "Driver" },
          attachments: expense.attachments ?? [],
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tripExpenseEvent: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          eventCreates.push(data);
          return Promise.resolve({ id: `evt-${eventCreates.length}` });
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const hashes: string[] = [];
    const resultsByHash = new Map<string, any>();
    const idempotency = {
      peekCompleted: jest.fn(async (params: any) => {
        hashes.push(params.requestHash);
        const hit = resultsByHash.get(params.requestHash);
        if (!hit) return null;
        if (hit.requestHashConflict) {
          throw new ConflictException({
            message: "Operation key reused with a different payload",
            code: "IDEMPOTENCY_KEY_CONFLICT",
          });
        }
        return { outcome: "replayed" as const, result: hit.result };
      }),
      execute: jest.fn(async (params: any) => {
        hashes.push(params.requestHash);
        const out = await params.execute(prisma);
        resultsByHash.set(params.requestHash, {
          result: out.result,
          requestHashConflict: false,
        });
        return { outcome: "created" as const, result: out.result };
      }) as jest.Mock,
    };

    const auditLog = jest.fn().mockResolvedValue(undefined);
    const svc = new TripExpensesService(
      prisma,
      { log: auditLog } as any,
      { getClient: () => ({ storage: { from: () => ({}) } }) } as any,
      idempotency as any,
    );
    return { svc, prisma, idempotency, hashes, resultsByHash, eventCreates, auditLog };
  }

  it("NEEDS_CLARIFICATION resubmit succeeds and replay after row change returns original", async () => {
    const expense: any = {
      id: "exp-1",
      tenantId,
      jobId,
      tripId,
      submittedByUserId: driverUserId,
      reviewStatus: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      amountCents: 1000,
      currency: "SGD",
      category: TripExpenseCategory.PARKING,
      transactionDate: new Date("2026-08-20"),
      remarks: "blurry",
      reviewReason: "Need clearer photo",
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      attachments: [{ id: "a1", isActive: true }],
    };
    const { svc, prisma, idempotency, hashes, eventCreates } = makeUpdateSvc(expense);

    const first = await svc.updateForDriver(tenantId, "exp-1", driverUserId, {
      remarks: "blurry",
      operationKey: OP,
    });
    expect(first.reviewStatus).toBe(TripExpenseReviewStatus.PENDING_REVIEW);
    expect(eventCreates).toHaveLength(1);

    // Simulate row change after success (status + updatedAt mutated).
    expense.reviewStatus = TripExpenseReviewStatus.PENDING_REVIEW;
    expense.updatedAt = new Date("2026-08-20T10:05:00.000Z");
    expense.reviewReason = null;

    const second = await svc.updateForDriver(tenantId, "exp-1", driverUserId, {
      remarks: "blurry",
      operationKey: OP,
    });
    expect(second).toEqual(first);
    expect(hashes[0]).toBe(hashes[1]);
    expect(idempotency.execute).toHaveBeenCalledTimes(1);
    expect(prisma.tripExpense.updateMany).toHaveBeenCalledTimes(1);
    expect(eventCreates).toHaveLength(1);
  });

  it("same key + different payload conflicts", async () => {
    const expense = {
      id: "exp-1",
      tenantId,
      jobId,
      tripId,
      submittedByUserId: driverUserId,
      reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      amountCents: 1000,
      currency: "SGD",
      category: TripExpenseCategory.PARKING,
      transactionDate: new Date("2026-08-20"),
      remarks: null,
      reviewReason: null,
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      attachments: [],
    };
    const completed = new Map<string, string>();
    const { svc, idempotency, prisma } = makeUpdateSvc(expense);
    idempotency.peekCompleted.mockImplementation(async (params: any) => {
      const prev = completed.get(params.operationKey);
      if (prev && prev !== params.requestHash) {
        throw new ConflictException({
          message: "Operation key reused with a different payload",
          code: "IDEMPOTENCY_KEY_CONFLICT",
        });
      }
      if (prev && prev === params.requestHash) {
        return {
          outcome: "replayed" as const,
          result: {
            id: "exp-1",
            reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
          },
        };
      }
      return null;
    });
    idempotency.execute.mockImplementation(async (params: any) => {
      const out = await params.execute(prisma);
      completed.set(params.operationKey, params.requestHash);
      return { outcome: "created" as const, result: out.result };
    });

    await svc.updateForDriver(tenantId, "exp-1", driverUserId, {
      remarks: "one",
      operationKey: OP,
    });
    await expect(
      svc.updateForDriver(tenantId, "exp-1", driverUserId, {
        remarks: "two",
        operationKey: OP,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("PENDING_REVIEW edit replay remains stable after updatedAt changes", async () => {
    const expense: any = {
      id: "exp-1",
      tenantId,
      jobId,
      tripId,
      submittedByUserId: driverUserId,
      reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      amountCents: 1000,
      currency: "SGD",
      category: TripExpenseCategory.PARKING,
      transactionDate: new Date("2026-08-20"),
      remarks: "a",
      reviewReason: null,
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      attachments: [],
    };
    const { svc, hashes, prisma } = makeUpdateSvc(expense);
    await svc.updateForDriver(tenantId, "exp-1", driverUserId, {
      amountCents: 1100,
      operationKey: OP,
    });
    expense.updatedAt = new Date("2026-08-20T11:00:00.000Z");
    expense.amountCents = 1100;
    await svc.updateForDriver(tenantId, "exp-1", driverUserId, {
      amountCents: 1100,
      operationKey: OP,
    });
    expect(hashes[0]).toBe(hashes[1]);
    expect(prisma.tripExpense.updateMany).toHaveBeenCalledTimes(1);
  });

  it("create-with-receipt digest: identical bytes replay; different bytes conflict before create", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const createCalls: any[] = [];
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          jobId,
          status: TripStatus.ONGOING,
          assignedDriverUserId: driverUserId,
        }),
      },
      drivers: { findFirst: jest.fn().mockResolvedValue({ id: "d1" }) },
      tripExpense: {
        findFirst: jest.fn().mockResolvedValue(null),
        findFirstOrThrow: jest.fn().mockImplementation(async () => ({
          id: "exp-1",
          tenantId,
          jobId,
          tripId,
          submittedByUserId: driverUserId,
          amountCents: 500,
          currency: "SGD",
          category: TripExpenseCategory.PARKING,
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
          reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
          transactionDate: new Date("2026-08-20"),
          remarks: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          attachments: [],
          job: { internalRef: "JOB-1" },
          submittedByUser: { name: "Driver" },
        })),
        create: jest.fn().mockImplementation(({ data }: any) => {
          createCalls.push(data);
          const row = {
            id: "exp-1",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            attachments: [],
            job: { internalRef: "JOB-1" },
            submittedByUser: { name: "Driver" },
          };
          return Promise.resolve(row);
        }),
      },
      tripExpenseAttachment: { create: jest.fn().mockResolvedValue({ id: "att-1" }) },
      tripExpenseEvent: { create: jest.fn().mockResolvedValue({ id: "evt" }) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const completed = new Map<string, { hash: string; result: any }>();
    const idempotency = {
      peekCompleted: jest.fn(async (params: any) => {
        const hit = completed.get(params.operationKey);
        if (!hit) return null;
        if (hit.hash !== params.requestHash) {
          throw new ConflictException({
            message: "Operation key reused with a different payload",
            code: "IDEMPOTENCY_KEY_CONFLICT",
          });
        }
        return { outcome: "replayed" as const, result: hit.result };
      }),
      execute: jest.fn(async (params: any) => {
        const out = await params.execute(prisma);
        completed.set(params.operationKey, {
          hash: params.requestHash,
          result: out.result,
        });
        return { outcome: "created" as const, result: out.result };
      }) as jest.Mock,
    };

    const auditLog = jest.fn().mockResolvedValue(undefined);
    const svc = new TripExpensesService(
      prisma,
      { log: auditLog } as any,
      {
        getClient: () => ({
          storage: { from: () => ({ upload, remove }) },
        }),
      } as any,
      idempotency as any,
    );

    const fileA = {
      buffer: Buffer.from("receipt-bytes-aaa"),
      originalname: "receipt.jpg",
      mimetype: "image/jpeg",
      size: 17,
    } as Express.Multer.File;
    const fileB = {
      buffer: Buffer.from("receipt-bytes-bbb"),
      originalname: "receipt.jpg",
      mimetype: "image/jpeg",
      size: 17,
    } as Express.Multer.File;

    const dto = {
      category: TripExpenseCategory.PARKING,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      amountCents: 500,
      transactionDate: "2026-08-20",
      operationKey: OP,
    };

    const created = await svc.createForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      dto,
      fileA,
    );
    expect(createCalls).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledTimes(1);

    const replayed = await svc.createForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      dto,
      fileA,
    );
    expect(replayed).toEqual(created);
    expect(createCalls).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(0);

    await expect(
      svc.createForDriver(tenantId, jobId, tripId, driverUserId, dto, fileB),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createCalls).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("repeated create replay does not add expense events or general audit actions", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          jobId,
          status: TripStatus.ONGOING,
          assignedDriverUserId: driverUserId,
        }),
      },
      drivers: { findFirst: jest.fn().mockResolvedValue({ id: "d1" }) },
      tripExpense: {
        findFirst: jest.fn().mockResolvedValue({
          id: "exp-1",
          tenantId,
          jobId,
          tripId,
          submittedByUserId: driverUserId,
          amountCents: 500,
          currency: "SGD",
          category: TripExpenseCategory.PARKING,
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
          reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
          transactionDate: new Date("2026-08-20"),
          remarks: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          attachments: [],
          job: { internalRef: "JOB-1" },
          submittedByUser: { name: "Driver" },
        }),
      },
      tripExpenseEvent: { create: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const auditLog = jest.fn();
    const existing = { id: "exp-1", amountCents: 500 };
    const idempotency = {
      peekCompleted: jest.fn().mockResolvedValue({
        outcome: "replayed",
        result: existing,
      }),
      execute: jest.fn(),
    };
    const svc = new TripExpensesService(
      prisma,
      { log: auditLog } as any,
      { getClient: () => ({ storage: { from: () => ({}) } }) } as any,
      idempotency as any,
    );

    await svc.createForDriver(tenantId, jobId, tripId, driverUserId, {
      category: TripExpenseCategory.PARKING,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      amountCents: 500,
      transactionDate: "2026-08-20",
      operationKey: OP,
    });
    await svc.createForDriver(tenantId, jobId, tripId, driverUserId, {
      category: TripExpenseCategory.PARKING,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      amountCents: 500,
      transactionDate: "2026-08-20",
      operationKey: OP,
    });
    expect(idempotency.execute).not.toHaveBeenCalled();
    expect(prisma.tripExpenseEvent.create).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
