import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IdempotencyRecordStatus, type Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  IdempotentExecuteResult,
  IdempotentOutcome,
} from "./idempotency.types";
import { isUniqueConstraintError } from "./idempotency.util";

export type IdempotentExecuteParams<T> = {
  tenantId: string;
  scope: string;
  operationKey: string;
  requestHash: string;
  /** Must verify tenant ownership before returning a replayed resource. */
  load: (resourceId: string) => Promise<T>;
  execute: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ resourceType: string; resourceId: string; result: T }>;
};

const RECONCILE_ATTEMPTS = 8;
const RECONCILE_DELAY_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(
    params: IdempotentExecuteParams<T>,
  ): Promise<IdempotentExecuteResult<T>> {
    const completed = await this.findCompletedRecord(params);
    if (completed) {
      return completed;
    }

    try {
      return await this.prisma.$transaction(async (tx) =>
        this.executeInTransaction(tx, params),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return this.reconcileAfterUniqueConflict(params, error);
      }
      throw error;
    }
  }

  async executeInTransaction<T>(
    tx: Prisma.TransactionClient,
    params: IdempotentExecuteParams<T>,
  ): Promise<IdempotentExecuteResult<T>> {
    const key = {
      tenantId: params.tenantId,
      scope: params.scope,
      operationKey: params.operationKey,
    };

    const existing = await tx.idempotencyRecord.findUnique({
      where: { tenantId_scope_operationKey: key },
    });
    if (existing?.status === IdempotencyRecordStatus.COMPLETED) {
      this.assertMatchingHash(existing.requestHash, params.requestHash);
      return this.replayed(params, existing.resourceId!);
    }

    let claimId: string;
    try {
      const claim = await tx.idempotencyRecord.create({
        data: {
          tenantId: params.tenantId,
          scope: params.scope,
          operationKey: params.operationKey,
          requestHash: params.requestHash,
          status: IdempotencyRecordStatus.PENDING,
        },
      });
      claimId = claim.id;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // PostgreSQL aborts the transaction on unique violation; recover outside tx.
        throw error;
      }
      throw error;
    }

    const outcome = await params.execute(tx);
    await tx.idempotencyRecord.update({
      where: { id: claimId },
      data: {
        status: IdempotencyRecordStatus.COMPLETED,
        resourceType: outcome.resourceType,
        resourceId: outcome.resourceId,
        completedAt: new Date(),
      },
    });
    return { outcome: "created", result: outcome.result };
  }

  private async findCompletedRecord<T>(
    params: IdempotentExecuteParams<T>,
  ): Promise<IdempotentExecuteResult<T> | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        tenantId_scope_operationKey: {
          tenantId: params.tenantId,
          scope: params.scope,
          operationKey: params.operationKey,
        },
      },
    });
    if (existing?.status !== IdempotencyRecordStatus.COMPLETED) {
      return null;
    }
    this.assertMatchingHash(existing.requestHash, params.requestHash);
    return this.replayed(params, existing.resourceId!);
  }

  private async reconcileAfterUniqueConflict<T>(
    params: IdempotentExecuteParams<T>,
    originalError: unknown,
  ): Promise<IdempotentExecuteResult<T>> {
    for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
      const raced = await this.prisma.idempotencyRecord.findUnique({
        where: {
          tenantId_scope_operationKey: {
            tenantId: params.tenantId,
            scope: params.scope,
            operationKey: params.operationKey,
          },
        },
      });
      if (raced?.status === IdempotencyRecordStatus.COMPLETED) {
        this.assertMatchingHash(raced.requestHash, params.requestHash);
        return this.replayed(params, raced.resourceId!);
      }
      if (
        raced?.status === IdempotencyRecordStatus.PENDING &&
        attempt < RECONCILE_ATTEMPTS - 1
      ) {
        await sleep(RECONCILE_DELAY_MS);
        continue;
      }
      if (raced?.status === IdempotencyRecordStatus.PENDING) {
        throw this.operationInProgress();
      }
      if (attempt < RECONCILE_ATTEMPTS - 1) {
        await sleep(RECONCILE_DELAY_MS);
      }
    }
    if (originalError instanceof Error) {
      throw originalError;
    }
    throw new ServiceUnavailableException(
      "Could not reconcile idempotent operation after unique-key conflict",
    );
  }

  private async replayed<T>(
    params: IdempotentExecuteParams<T>,
    resourceId: string,
  ): Promise<IdempotentExecuteResult<T>> {
    return {
      outcome: "replayed",
      result: await this.loadReplayResource(params, resourceId),
    };
  }

  private async loadReplayResource<T>(
    params: IdempotentExecuteParams<T>,
    resourceId: string,
  ): Promise<T> {
    if (!resourceId) {
      throw new ServiceUnavailableException(
        "Completed idempotency record is missing its resource id",
      );
    }
    return params.load(resourceId);
  }

  private operationInProgress(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message:
        "Onboarding operation is still in progress; retry with the same operation key",
      code: "IDEMPOTENCY_OPERATION_IN_PROGRESS",
      retryable: true,
    });
  }

  private assertMatchingHash(existingHash: string, requestHash: string) {
    if (existingHash !== requestHash) {
      throw new ConflictException({
        message: "Operation key reused with a different payload",
        code: "IDEMPOTENCY_KEY_CONFLICT",
      });
    }
  }

  /**
   * Read-only check for a completed idempotent operation.
   * Use before side effects (e.g. storage upload) so replays skip them.
   */
  async peekCompleted<T>(params: {
    tenantId: string;
    scope: string;
    operationKey: string;
    requestHash: string;
    load: (resourceId: string) => Promise<T>;
  }): Promise<IdempotentExecuteResult<T> | null> {
    return this.findCompletedRecord({
      ...params,
      execute: async () => {
        throw new Error("peekCompleted must not execute");
      },
    });
  }
}
