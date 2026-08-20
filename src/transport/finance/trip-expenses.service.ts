import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  TripExpenseEventAction,
  TripExpensePaymentMethod,
  TripExpenseReimbursementStatus,
  TripExpenseReviewStatus,
  TripStatus,
} from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { AuditService } from "../../shared/audit/audit.service";
import { SupabaseService } from "../../shared/auth/supabase.service";
import { IdempotencyService } from "../../shared/idempotency/idempotency.service";
import {
  hashRequestPayload,
  IDEMPOTENCY_SCOPES,
  sha256HexOfBuffer,
} from "../../shared/idempotency/idempotency.util";
import { assertStorageKeyBelongsToTenant } from "../../shared/storage/tenant-storage-key";
import { buildDocumentSignedUrlResponse } from "../documents/job-document-signed-url";
import {
  assertClientOperationKey,
  assertReviewTransition,
  assertValidAmountCents,
  expenseCategoryRequiresReceipt,
  isAllowedExpenseReceiptFile,
  isDriverEditableReviewStatus,
  nextReimbursementStatusOnPaymentMethodChange,
  normalizeIsoCurrency,
  reimbursementStatusForPaymentMethod,
  TRIP_EXPENSE_RECEIPT_MAX_BYTES,
} from "./trip-expense.rules";
import {
  AddTripExpenseAttachmentDto,
  ApproveTripExpenseDto,
  CreateTripExpenseDto,
  ListTripExpensesQueryDto,
  RejectTripExpenseDto,
  RequestTripExpenseClarificationDto,
  UpdateTripExpenseDto,
} from "./dto/trip-expense.dto";

const JOB_DOCUMENTS_BUCKET = "job-documents";

@Injectable()
export class TripExpensesService {
  private readonly logger = new Logger(TripExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabase: SupabaseService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private parseTransactionDate(isoDate: string): Date {
    const day = String(isoDate ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException("transactionDate must be YYYY-MM-DD");
    }
    return new Date(`${day}T00:00:00.000Z`);
  }

  private requireOperationKey(raw: unknown): string {
    try {
      return assertClientOperationKey(raw);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "operationKey is required");
    }
  }

  private async resolveDriverProfileId(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const row = await this.prisma.drivers.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async assertDriverAssignedTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
  ) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
        jobId,
        status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
        assignedDriverUserId: driverUserId,
      },
      select: {
        id: true,
        jobId: true,
        status: true,
        assignedDriverUserId: true,
      },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found or not assigned to you");
    }
    return trip;
  }

  private toExpenseDto(expense: any) {
    const attachments = Array.isArray(expense.attachments)
      ? expense.attachments
          .filter((a: any) => a.isActive !== false)
          .map((a: any) => ({
            id: a.id,
            originalName: a.originalName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes ?? null,
            uploadedByUserId: a.uploadedByUserId,
            createdAt: a.createdAt,
            isActive: a.isActive !== false,
          }))
      : [];
    return {
      id: expense.id,
      tenantId: expense.tenantId,
      jobId: expense.jobId,
      tripId: expense.tripId,
      submittedByUserId: expense.submittedByUserId,
      submittedByDriverId: expense.submittedByDriverId ?? null,
      category: expense.category,
      paymentMethod: expense.paymentMethod,
      amountCents: expense.amountCents,
      currency: expense.currency,
      transactionDate:
        expense.transactionDate instanceof Date
          ? expense.transactionDate.toISOString().slice(0, 10)
          : String(expense.transactionDate).slice(0, 10),
      remarks: expense.remarks ?? null,
      reviewStatus: expense.reviewStatus,
      reviewedByUserId: expense.reviewedByUserId ?? null,
      reviewedAt: expense.reviewedAt ?? null,
      reviewReason: expense.reviewReason ?? null,
      reimbursementStatus: expense.reimbursementStatus,
      reimbursedAt: expense.reimbursedAt ?? null,
      reimbursedByUserId: expense.reimbursedByUserId ?? null,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      attachments,
      jobInternalRef: expense.job?.internalRef ?? null,
      submittedByName: expense.submittedByUser?.name ?? null,
    };
  }

  private async putReceiptObject(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const client = this.supabase.getClient();
    const { error } = await client.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .upload(storageKey, buffer, { contentType, upsert: false });
    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }
  }

  /**
   * Best-effort storage cleanup. Failures are logged for reconciliation and never
   * mask the canonical DB/API outcome.
   */
  private async removeStorageObjectSafe(
    storageKey: string,
    context: Record<string, string>,
  ): Promise<boolean> {
    try {
      const client = this.supabase.getClient();
      const { error } = await client.storage
        .from(JOB_DOCUMENTS_BUCKET)
        .remove([storageKey]);
      if (error) {
        this.logger.error(
          `Trip expense storage cleanup failed key=${storageKey} context=${JSON.stringify(context)} error=${error.message}`,
        );
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(
        `Trip expense storage cleanup failed key=${storageKey} context=${JSON.stringify(context)} error=${err?.message ?? String(err)}`,
      );
      return false;
    }
  }

  /**
   * Post-commit AuditLog must not flip a successful financial transition into an API error.
   * TripExpenseEvent remains the transactional SoT; this log is for reconciliation.
   */
  private async logAuditAfterCommit(
    tenantId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    actorUserId: string | null,
  ): Promise<void> {
    try {
      await this.audit.log(
        tenantId,
        action,
        "TRIP_EXPENSE",
        entityId,
        metadata,
        actorUserId,
      );
    } catch (err: any) {
      this.logger.error(
        `Post-commit audit log failed tenantId=${tenantId} action=${action} entityType=TRIP_EXPENSE entityId=${entityId} actorUserId=${actorUserId ?? "null"} error=${err?.message ?? String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private conflictStaleTransition(message: string): ConflictException {
    return new ConflictException({
      message,
      code: "TRIP_EXPENSE_STATE_CONFLICT",
    });
  }

  private expenseInclude() {
    return {
      attachments: {
        where: { isActive: true },
        orderBy: { createdAt: "asc" as const },
      },
      job: { select: { internalRef: true } },
      submittedByUser: { select: { name: true } },
    };
  }

  async createForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
    dto: CreateTripExpenseDto,
    file?: Express.Multer.File | null,
  ) {
    await this.assertDriverAssignedTrip(tenantId, jobId, tripId, driverUserId);

    const operationKey = this.requireOperationKey(dto.operationKey);

    let amountCents: number;
    let currency: string;
    try {
      amountCents = assertValidAmountCents(dto.amountCents);
      currency = normalizeIsoCurrency(dto.currency ?? "SGD");
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "Invalid amount or currency");
    }

    const transactionDate = this.parseTransactionDate(dto.transactionDate);
    const reimbursementStatus = reimbursementStatusForPaymentMethod(
      dto.paymentMethod,
    );
    const driverId = await this.resolveDriverProfileId(tenantId, driverUserId);

    const receiptSha256 =
      file?.buffer?.length ? sha256HexOfBuffer(file.buffer) : null;

    /**
     * Stable replay identity — driver + trip + canonical client fields + receipt digest.
     * Must not include mutable DB status, updatedAt, or derived reimbursement state.
     */
    const requestHash = hashRequestPayload({
      scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_CREATE,
      driverUserId,
      jobId,
      tripId,
      category: dto.category,
      paymentMethod: dto.paymentMethod,
      amountCents,
      currency,
      transactionDate: dto.transactionDate,
      remarks: dto.remarks?.trim() || null,
      receiptSha256,
      fileName: file?.originalname ?? null,
      fileSize: file?.size ?? null,
      fileMime: file?.mimetype ?? null,
    });

    const loadExpense = async (resourceId: string) => {
      const existing = await this.prisma.tripExpense.findFirst({
        where: { id: resourceId, tenantId, submittedByUserId: driverUserId },
        include: this.expenseInclude(),
      });
      if (!existing) throw new NotFoundException("Expense not found");
      return this.toExpenseDto(existing);
    };

    const peeked = await this.idempotency.peekCompleted({
      tenantId,
      scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_CREATE,
      operationKey,
      requestHash,
      load: loadExpense,
    });
    if (peeked) {
      return peeked.result;
    }

    let uploadedKey: string | null = null;
    if (file?.buffer?.length) {
      const check = isAllowedExpenseReceiptFile({
        mimeType: file.mimetype,
        originalName: file.originalname,
        sizeBytes: file.size,
      });
      if (check.ok === false) {
        throw new BadRequestException(check.reason);
      }
      const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
      uploadedKey = `${tenantId}/jobs/${jobId}/trips/${tripId}/expenses/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
      await this.putReceiptObject(
        uploadedKey,
        file.buffer,
        file.mimetype ?? "application/octet-stream",
      );
    }

    try {
      const result = await this.idempotency.execute({
        tenantId,
        scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_CREATE,
        operationKey,
        requestHash,
        load: loadExpense,
        execute: async (tx) => {
          const expense = await tx.tripExpense.create({
            data: {
              tenantId,
              jobId,
              tripId,
              submittedByUserId: driverUserId,
              submittedByDriverId: driverId,
              category: dto.category,
              paymentMethod: dto.paymentMethod,
              amountCents,
              currency,
              transactionDate,
              remarks: dto.remarks?.trim() || null,
              reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
              reimbursementStatus,
            },
          });
          if (uploadedKey && file) {
            await tx.tripExpenseAttachment.create({
              data: {
                tenantId,
                expenseId: expense.id,
                storageKey: uploadedKey,
                originalName: file.originalname ?? "receipt",
                mimeType: file.mimetype ?? "application/octet-stream",
                sizeBytes: file.size ?? null,
                uploadedByUserId: driverUserId,
                isActive: true,
              },
            });
          }
          await tx.tripExpenseEvent.create({
            data: {
              tenantId,
              expenseId: expense.id,
              actorUserId: driverUserId,
              action: TripExpenseEventAction.SUBMITTED,
              previousStatus: null,
              newStatus: TripExpenseReviewStatus.PENDING_REVIEW,
              changedFieldsJson: {
                amountCents,
                currency,
                category: dto.category,
                paymentMethod: dto.paymentMethod,
              } as Prisma.InputJsonValue,
            },
          });
          if (uploadedKey) {
            await tx.tripExpenseEvent.create({
              data: {
                tenantId,
                expenseId: expense.id,
                actorUserId: driverUserId,
                action: TripExpenseEventAction.ATTACHMENT_ADDED,
                newStatus: TripExpenseReviewStatus.PENDING_REVIEW,
              },
            });
          }
          const full = await tx.tripExpense.findFirstOrThrow({
            where: { id: expense.id, tenantId },
            include: this.expenseInclude(),
          });
          return {
            resourceType: "TRIP_EXPENSE",
            resourceId: expense.id,
            result: this.toExpenseDto(full),
          };
        },
      });

      if (result.outcome === "replayed" && uploadedKey) {
        await this.removeStorageObjectSafe(uploadedKey, {
          reason: "idempotent_replay",
          tenantId,
          tripId,
          operationKey,
        });
      }

      if (result.outcome === "created") {
        await this.logAuditAfterCommit(
          tenantId,
          "TRIP_EXPENSE_SUBMIT",
          result.result.id,
          { tripId, jobId, reviewStatus: "PENDING_REVIEW" },
          driverUserId,
        );
      }
      return result.result;
    } catch (error) {
      if (uploadedKey) {
        await this.removeStorageObjectSafe(uploadedKey, {
          reason: "db_failure_after_upload",
          tenantId,
          tripId,
          operationKey,
        });
      }
      throw error;
    }
  }

  async addAttachmentForDriver(
    tenantId: string,
    expenseId: string,
    driverUserId: string,
    file: Express.Multer.File,
    dto: AddTripExpenseAttachmentDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Receipt file is required");
    }
    const operationKey = this.requireOperationKey(dto.operationKey);
    const check = isAllowedExpenseReceiptFile({
      mimeType: file.mimetype,
      originalName: file.originalname,
      sizeBytes: file.size,
    });
    if (check.ok === false) {
      throw new BadRequestException(check.reason);
    }

    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId, submittedByUserId: driverUserId },
    });
    if (!expense) throw new NotFoundException("Expense not found");
    if (!isDriverEditableReviewStatus(expense.reviewStatus)) {
      throw new ForbiddenException(
        "Expense cannot be modified in its current status",
      );
    }
    await this.assertDriverAssignedTrip(
      tenantId,
      expense.jobId,
      expense.tripId,
      driverUserId,
    );

    const receiptSha256 = sha256HexOfBuffer(file.buffer);
    /**
     * Stable replay identity — driver + expense + receipt digest + file metadata.
     * Digest distinguishes identical name/size/MIME with different bytes.
     */
    const requestHash = hashRequestPayload({
      scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_ATTACHMENT,
      driverUserId,
      expenseId,
      receiptSha256,
      fileName: file.originalname ?? null,
      fileSize: file.size ?? null,
      fileMime: file.mimetype ?? null,
    });

    const loadAttachment = async (resourceId: string) => {
      const att = await this.prisma.tripExpenseAttachment.findFirst({
        where: { id: resourceId, tenantId, expenseId },
      });
      if (!att) throw new NotFoundException("Attachment not found");
      return {
        id: att.id,
        originalName: att.originalName,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        createdAt: att.createdAt,
      };
    };

    const peeked = await this.idempotency.peekCompleted({
      tenantId,
      scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_ATTACHMENT,
      operationKey,
      requestHash,
      load: loadAttachment,
    });
    if (peeked) {
      return peeked.result;
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    const storageKey = `${tenantId}/jobs/${expense.jobId}/trips/${expense.tripId}/expenses/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    await this.putReceiptObject(
      storageKey,
      file.buffer,
      file.mimetype ?? "application/octet-stream",
    );

    try {
      const result = await this.idempotency.execute({
        tenantId,
        scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_ATTACHMENT,
        operationKey,
        requestHash,
        load: loadAttachment,
        execute: async (tx) => {
          const stillEditable = await tx.tripExpense.findFirst({
            where: {
              id: expenseId,
              tenantId,
              submittedByUserId: driverUserId,
              reviewStatus: {
                in: [
                  TripExpenseReviewStatus.PENDING_REVIEW,
                  TripExpenseReviewStatus.NEEDS_CLARIFICATION,
                ],
              },
            },
            select: { id: true, reviewStatus: true },
          });
          if (!stillEditable) {
            throw this.conflictStaleTransition(
              "Expense is no longer editable; attachment was not added",
            );
          }

          const att = await tx.tripExpenseAttachment.create({
            data: {
              tenantId,
              expenseId,
              storageKey,
              originalName: file.originalname ?? "receipt",
              mimeType: file.mimetype ?? "application/octet-stream",
              sizeBytes: file.size ?? null,
              uploadedByUserId: driverUserId,
              isActive: true,
            },
          });
          await tx.tripExpenseEvent.create({
            data: {
              tenantId,
              expenseId,
              actorUserId: driverUserId,
              action: TripExpenseEventAction.ATTACHMENT_ADDED,
              newStatus: stillEditable.reviewStatus,
            },
          });
          return {
            resourceType: "TRIP_EXPENSE_ATTACHMENT",
            resourceId: att.id,
            result: {
              id: att.id,
              originalName: att.originalName,
              mimeType: att.mimeType,
              sizeBytes: att.sizeBytes,
              createdAt: att.createdAt,
            },
          };
        },
      });

      if (result.outcome === "replayed") {
        await this.removeStorageObjectSafe(storageKey, {
          reason: "idempotent_replay",
          tenantId,
          expenseId,
          operationKey,
        });
      }

      return result.result;
    } catch (error) {
      await this.removeStorageObjectSafe(storageKey, {
        reason: "db_failure_after_upload",
        tenantId,
        expenseId,
        operationKey,
      });
      throw error;
    }
  }

  async updateForDriver(
    tenantId: string,
    expenseId: string,
    driverUserId: string,
    dto: UpdateTripExpenseDto,
  ) {
    const operationKey = this.requireOperationKey(dto.operationKey);

    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId, submittedByUserId: driverUserId },
    });
    if (!expense) throw new NotFoundException("Expense not found");
    if (!isDriverEditableReviewStatus(expense.reviewStatus)) {
      throw new ForbiddenException(
        "Expense cannot be modified in its current status",
      );
    }
    await this.assertDriverAssignedTrip(
      tenantId,
      expense.jobId,
      expense.tripId,
      driverUserId,
    );

    const nextPaymentMethod = dto.paymentMethod ?? expense.paymentMethod;
    let amountCents = expense.amountCents;
    let currency = expense.currency;
    try {
      if (dto.amountCents !== undefined) {
        amountCents = assertValidAmountCents(dto.amountCents);
      }
      if (dto.currency !== undefined) {
        currency = normalizeIsoCurrency(dto.currency);
      }
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "Invalid amount or currency");
    }

    const reimbursementStatus = nextReimbursementStatusOnPaymentMethodChange(
      nextPaymentMethod,
      {
        paymentMethod: expense.paymentMethod,
        reimbursementStatus: expense.reimbursementStatus,
      },
    );

    const fromStatus = expense.reviewStatus;
    const toStatus = TripExpenseReviewStatus.PENDING_REVIEW;
    if (fromStatus === TripExpenseReviewStatus.NEEDS_CLARIFICATION) {
      try {
        assertReviewTransition(fromStatus, toStatus);
      } catch (e: any) {
        throw new BadRequestException(e?.message ?? "Invalid transition");
      }
    }

    const category = dto.category ?? expense.category;
    const transactionDate = dto.transactionDate
      ? this.parseTransactionDate(dto.transactionDate)
      : expense.transactionDate;
    const remarks =
      dto.remarks === undefined ? expense.remarks : dto.remarks.trim() || null;

    /**
     * Stable replay identity — driver + expense + scope + canonical client intent only.
     * CAS still uses current reviewStatus + updatedAt inside first execution.
     */
    const requestHash = hashRequestPayload({
      scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_RESUBMIT,
      driverUserId,
      expenseId,
      category: dto.category ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      amountCents: dto.amountCents ?? null,
      currency: dto.currency ?? null,
      transactionDate: dto.transactionDate ?? null,
      remarks: dto.remarks === undefined ? null : dto.remarks.trim() || null,
    });

    const loadExpense = async (resourceId: string) => {
      const existing = await this.prisma.tripExpense.findFirst({
        where: { id: resourceId, tenantId, submittedByUserId: driverUserId },
        include: this.expenseInclude(),
      });
      if (!existing) throw new NotFoundException("Expense not found");
      return this.toExpenseDto(existing);
    };

    const peeked = await this.idempotency.peekCompleted({
      tenantId,
      scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_RESUBMIT,
      operationKey,
      requestHash,
      load: loadExpense,
    });
    if (peeked) {
      return peeked.result;
    }

    const result = await this.idempotency.execute({
      tenantId,
      scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_EXPENSE_RESUBMIT,
      operationKey,
      requestHash,
      load: loadExpense,
      execute: async (tx) => {
        const cas = await tx.tripExpense.updateMany({
          where: {
            id: expense.id,
            tenantId,
            submittedByUserId: driverUserId,
            reviewStatus: fromStatus,
            updatedAt: expense.updatedAt,
          },
          data: {
            category,
            paymentMethod: nextPaymentMethod,
            amountCents,
            currency,
            transactionDate,
            remarks,
            reviewStatus: toStatus,
            reviewReason:
              toStatus === TripExpenseReviewStatus.PENDING_REVIEW &&
              fromStatus === TripExpenseReviewStatus.NEEDS_CLARIFICATION
                ? null
                : expense.reviewReason,
            reimbursementStatus,
            ...(reimbursementStatus ===
            TripExpenseReimbursementStatus.NOT_REQUIRED
              ? { reimbursedAt: null, reimbursedByUserId: null }
              : {}),
          },
        });
        if (cas.count !== 1) {
          throw this.conflictStaleTransition(
            "Expense was updated concurrently; refresh and retry",
          );
        }

        await tx.tripExpenseEvent.create({
          data: {
            tenantId,
            expenseId: expense.id,
            actorUserId: driverUserId,
            action:
              fromStatus === TripExpenseReviewStatus.NEEDS_CLARIFICATION
                ? TripExpenseEventAction.RESUBMITTED
                : TripExpenseEventAction.UPDATED,
            previousStatus: fromStatus,
            newStatus: toStatus,
            changedFieldsJson: {
              amountCents,
              currency,
              category,
              paymentMethod: nextPaymentMethod,
              reimbursementStatus,
            } as Prisma.InputJsonValue,
          },
        });

        const row = await tx.tripExpense.findFirstOrThrow({
          where: { id: expense.id, tenantId },
          include: this.expenseInclude(),
        });
        return {
          resourceType: "TRIP_EXPENSE",
          resourceId: expense.id,
          result: this.toExpenseDto(row),
        };
      },
    });

    return result.result;
  }

  async listForDriverTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
  ) {
    await this.assertDriverAssignedTrip(tenantId, jobId, tripId, driverUserId);
    const rows = await this.prisma.tripExpense.findMany({
      where: {
        tenantId,
        jobId,
        tripId,
        submittedByUserId: driverUserId,
      },
      include: this.expenseInclude(),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map((r) => this.toExpenseDto(r));
  }

  async getForDriver(
    tenantId: string,
    expenseId: string,
    driverUserId: string,
  ) {
    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId, submittedByUserId: driverUserId },
      include: this.expenseInclude(),
    });
    if (!expense) throw new NotFoundException("Expense not found");
    await this.assertDriverAssignedTrip(
      tenantId,
      expense.jobId,
      expense.tripId,
      driverUserId,
    );
    return this.toExpenseDto(expense);
  }

  async listForFinance(tenantId: string, query: ListTripExpensesQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(query.pageSize ?? 20) || 20),
    );
    const where: Prisma.TripExpenseWhereInput = {
      tenantId,
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.reimbursementStatus
        ? { reimbursementStatus: query.reimbursementStatus }
        : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.driverUserId ? { submittedByUserId: query.driverUserId } : {}),
      ...(query.jobId ? { jobId: query.jobId } : {}),
      ...(query.tripId ? { tripId: query.tripId } : {}),
      ...(query.transactionDateFrom || query.transactionDateTo
        ? {
            transactionDate: {
              ...(query.transactionDateFrom
                ? {
                    gte: this.parseTransactionDate(query.transactionDateFrom),
                  }
                : {}),
              ...(query.transactionDateTo
                ? {
                    lte: this.parseTransactionDate(query.transactionDateTo),
                  }
                : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.tripExpense.count({ where }),
      this.prisma.tripExpense.findMany({
        where,
        include: {
          attachments: {
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
          },
          job: { select: { internalRef: true } },
          submittedByUser: { select: { name: true, email: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map((r) => this.toExpenseDto(r)),
      meta: { page, pageSize, total },
    };
  }

  async getForFinance(tenantId: string, expenseId: string) {
    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId },
      include: {
        attachments: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        },
        job: { select: { internalRef: true } },
        submittedByUser: { select: { name: true, email: true } },
      },
    });
    if (!expense) throw new NotFoundException("Expense not found");
    return this.toExpenseDto(expense);
  }

  async listEvents(tenantId: string, expenseId: string) {
    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId },
      select: { id: true },
    });
    if (!expense) throw new NotFoundException("Expense not found");
    const events = await this.prisma.tripExpenseEvent.findMany({
      where: { tenantId, expenseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      previousStatus: e.previousStatus,
      newStatus: e.newStatus,
      reason: e.reason,
      changedFields: e.changedFieldsJson,
      actorUserId: e.actorUserId,
      actorName: e.actor?.name ?? null,
      createdAt: e.createdAt,
    }));
  }

  async getAttachmentSignedUrl(
    tenantId: string,
    expenseId: string,
    attachmentId: string,
    opts?: { driverUserId?: string },
  ) {
    const expense = await this.prisma.tripExpense.findFirst({
      where: {
        id: expenseId,
        tenantId,
        ...(opts?.driverUserId
          ? { submittedByUserId: opts.driverUserId }
          : {}),
      },
      select: { id: true, jobId: true, tripId: true, submittedByUserId: true },
    });
    if (!expense) throw new NotFoundException("Expense not found");
    if (opts?.driverUserId) {
      await this.assertDriverAssignedTrip(
        tenantId,
        expense.jobId,
        expense.tripId,
        opts.driverUserId,
      );
    }

    const attachment = await this.prisma.tripExpenseAttachment.findFirst({
      where: {
        id: attachmentId,
        tenantId,
        expenseId,
        isActive: true,
      },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");
    assertStorageKeyBelongsToTenant(attachment.storageKey, tenantId);

    const signed = await buildDocumentSignedUrlResponse(
      this.supabase.getClient(),
      attachment.storageKey,
      tenantId,
    );
    return {
      attachmentId: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      ...signed,
    };
  }

  async approve(
    tenantId: string,
    expenseId: string,
    actorUserId: string,
    dto: ApproveTripExpenseDto,
  ) {
    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId },
      include: { attachments: { where: { isActive: true } } },
    });
    if (!expense) throw new NotFoundException("Expense not found");

    try {
      assertReviewTransition(
        expense.reviewStatus,
        TripExpenseReviewStatus.APPROVED,
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "Invalid transition");
    }

    if (
      expenseCategoryRequiresReceipt(expense.category) &&
      (expense.attachments?.length ?? 0) < 1
    ) {
      throw new BadRequestException(
        "At least one active receipt is required for approval",
      );
    }

    let amountCents = expense.amountCents;
    let category = expense.category;
    let paymentMethod = expense.paymentMethod;
    let reimbursementStatus = expense.reimbursementStatus;
    const corrections: Record<string, unknown> = {};

    if (dto.amountCents !== undefined) {
      try {
        amountCents = assertValidAmountCents(dto.amountCents);
      } catch (e: any) {
        throw new BadRequestException(e?.message ?? "Invalid amount");
      }
      if (amountCents !== expense.amountCents) {
        corrections.amountCents = { from: expense.amountCents, to: amountCents };
      }
    }
    if (dto.category !== undefined && dto.category !== expense.category) {
      category = dto.category;
      corrections.category = { from: expense.category, to: category };
    }
    if (
      dto.paymentMethod !== undefined &&
      dto.paymentMethod !== expense.paymentMethod
    ) {
      paymentMethod = dto.paymentMethod;
      reimbursementStatus = nextReimbursementStatusOnPaymentMethodChange(
        paymentMethod,
        {
          paymentMethod: expense.paymentMethod,
          reimbursementStatus: expense.reimbursementStatus,
        },
      );
      corrections.paymentMethod = {
        from: expense.paymentMethod,
        to: paymentMethod,
      };
      corrections.reimbursementStatus = {
        from: expense.reimbursementStatus,
        to: reimbursementStatus,
      };
    }

    const note = String(dto.note ?? "").trim() || null;
    const hasCorrections = Object.keys(corrections).length > 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.tripExpense.updateMany({
        where: {
          id: expense.id,
          tenantId,
          reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
          updatedAt: expense.updatedAt,
        },
        data: {
          amountCents,
          category,
          paymentMethod,
          reimbursementStatus,
          ...(reimbursementStatus === TripExpenseReimbursementStatus.NOT_REQUIRED
            ? { reimbursedAt: null, reimbursedByUserId: null }
            : {}),
          reviewStatus: TripExpenseReviewStatus.APPROVED,
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
          reviewReason: null,
        },
      });
      if (cas.count !== 1) {
        throw this.conflictStaleTransition(
          "Expense is no longer PENDING_REVIEW; approval was not applied",
        );
      }

      if (hasCorrections) {
        await tx.tripExpenseEvent.create({
          data: {
            tenantId,
            expenseId: expense.id,
            actorUserId,
            action: TripExpenseEventAction.REVIEWER_CORRECTED,
            previousStatus: expense.reviewStatus,
            newStatus: TripExpenseReviewStatus.APPROVED,
            reason: note,
            changedFieldsJson: corrections as Prisma.InputJsonValue,
          },
        });
      }
      await tx.tripExpenseEvent.create({
        data: {
          tenantId,
          expenseId: expense.id,
          actorUserId,
          action: TripExpenseEventAction.APPROVED,
          previousStatus: expense.reviewStatus,
          newStatus: TripExpenseReviewStatus.APPROVED,
          reason: note,
        },
      });

      return tx.tripExpense.findFirstOrThrow({
        where: { id: expense.id, tenantId },
        include: this.expenseInclude(),
      });
    });

    await this.logAuditAfterCommit(
      tenantId,
      "TRIP_EXPENSE_APPROVED",
      expense.id,
      { from: expense.reviewStatus, to: TripExpenseReviewStatus.APPROVED },
      actorUserId,
    );

    return this.toExpenseDto(updated);
  }

  async reject(
    tenantId: string,
    expenseId: string,
    actorUserId: string,
    dto: RejectTripExpenseDto,
  ) {
    const reason = String(dto.reason ?? "").trim();
    if (!reason) {
      throw new BadRequestException("reason is required");
    }

    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId },
    });
    if (!expense) throw new NotFoundException("Expense not found");

    try {
      assertReviewTransition(
        expense.reviewStatus,
        TripExpenseReviewStatus.REJECTED,
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "Invalid transition");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.tripExpense.updateMany({
        where: {
          id: expense.id,
          tenantId,
          reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
          updatedAt: expense.updatedAt,
        },
        data: {
          reviewStatus: TripExpenseReviewStatus.REJECTED,
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
          reviewReason: reason,
        },
      });
      if (cas.count !== 1) {
        throw this.conflictStaleTransition(
          "Expense is no longer PENDING_REVIEW; rejection was not applied",
        );
      }

      await tx.tripExpenseEvent.create({
        data: {
          tenantId,
          expenseId: expense.id,
          actorUserId,
          action: TripExpenseEventAction.REJECTED,
          previousStatus: expense.reviewStatus,
          newStatus: TripExpenseReviewStatus.REJECTED,
          reason,
        },
      });

      return tx.tripExpense.findFirstOrThrow({
        where: { id: expense.id, tenantId },
        include: this.expenseInclude(),
      });
    });

    await this.logAuditAfterCommit(
      tenantId,
      "TRIP_EXPENSE_REJECTED",
      expense.id,
      { from: expense.reviewStatus, to: TripExpenseReviewStatus.REJECTED },
      actorUserId,
    );

    return this.toExpenseDto(updated);
  }

  async requestClarification(
    tenantId: string,
    expenseId: string,
    actorUserId: string,
    dto: RequestTripExpenseClarificationDto,
  ) {
    const reason = String(dto.reason ?? "").trim();
    if (!reason) {
      throw new BadRequestException("reason is required");
    }

    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId },
    });
    if (!expense) throw new NotFoundException("Expense not found");

    try {
      assertReviewTransition(
        expense.reviewStatus,
        TripExpenseReviewStatus.NEEDS_CLARIFICATION,
      );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "Invalid transition");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.tripExpense.updateMany({
        where: {
          id: expense.id,
          tenantId,
          reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
          updatedAt: expense.updatedAt,
        },
        data: {
          reviewStatus: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
          reviewReason: reason,
        },
      });
      if (cas.count !== 1) {
        throw this.conflictStaleTransition(
          "Expense is no longer PENDING_REVIEW; clarification was not applied",
        );
      }

      await tx.tripExpenseEvent.create({
        data: {
          tenantId,
          expenseId: expense.id,
          actorUserId,
          action: TripExpenseEventAction.CLARIFICATION_REQUESTED,
          previousStatus: expense.reviewStatus,
          newStatus: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
          reason,
        },
      });

      return tx.tripExpense.findFirstOrThrow({
        where: { id: expense.id, tenantId },
        include: this.expenseInclude(),
      });
    });

    await this.logAuditAfterCommit(
      tenantId,
      "TRIP_EXPENSE_CLARIFICATION_REQUESTED",
      expense.id,
      {
        from: expense.reviewStatus,
        to: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
      },
      actorUserId,
    );

    return this.toExpenseDto(updated);
  }

  async markReimbursementPaid(
    tenantId: string,
    expenseId: string,
    actorUserId: string,
  ) {
    const expense = await this.prisma.tripExpense.findFirst({
      where: { id: expenseId, tenantId },
    });
    if (!expense) throw new NotFoundException("Expense not found");
    if (expense.paymentMethod !== TripExpensePaymentMethod.DRIVER_PAID) {
      throw new BadRequestException(
        "Only DRIVER_PAID expenses require reimbursement",
      );
    }
    if (expense.reviewStatus !== TripExpenseReviewStatus.APPROVED) {
      throw new BadRequestException(
        "Expense must be APPROVED before reimbursement",
      );
    }
    if (
      expense.reimbursementStatus !== TripExpenseReimbursementStatus.PENDING
    ) {
      throw this.conflictStaleTransition(
        "Reimbursement is not PENDING; mark-paid was not applied",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.tripExpense.updateMany({
        where: {
          id: expense.id,
          tenantId,
          reviewStatus: TripExpenseReviewStatus.APPROVED,
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
          updatedAt: expense.updatedAt,
        },
        data: {
          reimbursementStatus: TripExpenseReimbursementStatus.PAID,
          reimbursedAt: new Date(),
          reimbursedByUserId: actorUserId,
        },
      });
      if (cas.count !== 1) {
        throw this.conflictStaleTransition(
          "Reimbursement state changed concurrently; mark-paid was not applied",
        );
      }

      await tx.tripExpenseEvent.create({
        data: {
          tenantId,
          expenseId: expense.id,
          actorUserId,
          action: TripExpenseEventAction.REIMBURSEMENT_MARKED_PAID,
          previousStatus: expense.reviewStatus,
          newStatus: expense.reviewStatus,
          changedFieldsJson: {
            reimbursementStatus: {
              from: expense.reimbursementStatus,
              to: TripExpenseReimbursementStatus.PAID,
            },
            note: "Reimbursement does not add job cost",
          } as Prisma.InputJsonValue,
        },
      });

      return tx.tripExpense.findFirstOrThrow({
        where: { id: expense.id, tenantId },
        include: this.expenseInclude(),
      });
    });

    await this.logAuditAfterCommit(
      tenantId,
      "TRIP_EXPENSE_REIMBURSEMENT_PAID",
      expense.id,
      { amountCents: expense.amountCents },
      actorUserId,
    );

    return this.toExpenseDto(updated);
  }
}

export { TRIP_EXPENSE_RECEIPT_MAX_BYTES };
