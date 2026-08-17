import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { IdempotencyRecordStatus } from "@prisma/client";
import { IdempotencyService } from "./idempotency.service";
import { hashRequestPayload, isUniqueConstraintError } from "./idempotency.util";

type StoredRecord = {
  id: string;
  tenantId: string;
  scope: string;
  operationKey: string;
  requestHash: string;
  status: IdempotencyRecordStatus;
  resourceType: string | null;
  resourceId: string | null;
};

function uniqueViolationError() {
  const error: any = new Error("Unique constraint");
  error.code = "P2002";
  error.meta = { target: ["tenantId", "scope", "operationKey"] };
  return error;
}

/** Simulates PostgreSQL: unique violation aborts the transaction immediately. */
function makePostgresLikeHarness() {
  const records = new Map<string, StoredRecord>();
  const keyOf = (tenantId: string, scope: string, operationKey: string) =>
    `${tenantId}\0${scope}\0${operationKey}`;
  const txLocks = new Map<string, Promise<void>>();
  let nextId = 1;

  const withKeyLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = txLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    txLocks.set(key, previous.then(() => gate));
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (txLocks.get(key) === gate) {
        txLocks.delete(key);
      }
    }
  };

  const prisma: any = {
    idempotencyRecord: {
      findUnique: async ({ where }: any) => {
        const key = keyOf(
          where.tenantId_scope_operationKey.tenantId,
          where.tenantId_scope_operationKey.scope,
          where.tenantId_scope_operationKey.operationKey,
        );
        return records.get(key) ?? null;
      },
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) =>
      withKeyLock("global-tx", async () => {
        const snapshot = new Map(records);
        let txAborted = false;
        const tx = {
          idempotencyRecord: {
            findUnique: async ({ where }: any) => {
              if (txAborted) {
                throw new Error("current transaction is aborted");
              }
              const key = keyOf(
                where.tenantId_scope_operationKey.tenantId,
                where.tenantId_scope_operationKey.scope,
                where.tenantId_scope_operationKey.operationKey,
              );
              return records.get(key) ?? null;
            },
            create: async ({ data }: any) => {
              if (txAborted) {
                throw new Error("current transaction is aborted");
              }
              const key = keyOf(data.tenantId, data.scope, data.operationKey);
              if (records.has(key)) {
                txAborted = true;
                throw uniqueViolationError();
              }
              const row: StoredRecord = {
                id: `rec-${nextId++}`,
                tenantId: data.tenantId,
                scope: data.scope,
                operationKey: data.operationKey,
                requestHash: data.requestHash,
                status: data.status ?? IdempotencyRecordStatus.PENDING,
                resourceType: data.resourceType ?? null,
                resourceId: data.resourceId ?? null,
              };
              records.set(key, row);
              return row;
            },
            update: async ({ where, data }: any) => {
              if (txAborted) {
                throw new Error("current transaction is aborted");
              }
              const row = [...records.values()].find((entry) => entry.id === where.id);
              if (!row) throw new Error("missing record");
              Object.assign(row, data);
              return row;
            },
          },
        };
        try {
          return await fn(tx);
        } catch (error) {
          records.clear();
          for (const [key, value] of snapshot.entries()) {
            records.set(key, value);
          }
          throw error;
        }
      }),
  };

  return { prisma, records };
}

describe("IdempotencyService PostgreSQL-like concurrency", () => {
  it("creates one resource and reconciles parallel identical callers to the same id", async () => {
    const { prisma, records } = makePostgresLikeHarness();
    const svc = new IdempotencyService(prisma);
    const hash = hashRequestPayload({ name: "Acme" });
    let createCount = 0;

    const run = () =>
      svc.execute({
        tenantId: "t1",
        scope: "CUSTOMER_ONBOARDING",
        operationKey: "op-parallel",
        requestHash: hash,
        load: async (resourceId) => ({ id: resourceId, name: "Acme" }),
        execute: async () => {
          createCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 8));
          return {
            resourceType: "customer_companies",
            resourceId: `company-${createCount}`,
            result: { id: `company-${createCount}`, name: "Acme" },
          };
        },
      });

    const results = await Promise.all([run(), run(), run(), run()]);
    expect(createCount).toBe(1);
    expect(records.size).toBe(1);
    expect([...records.values()][0]?.status).toBe(IdempotencyRecordStatus.COMPLETED);
    expect(new Set(results.map((row) => row.result.id)).size).toBe(1);
    expect(results.every((row) => row.outcome === "created" || row.outcome === "replayed")).toBe(
      true,
    );
    expect(results.some((row) => row.outcome === "created")).toBe(true);
    expect(results.filter((row) => row.outcome === "replayed").length).toBeGreaterThan(0);
  });

  it("reconciles after unique conflict instead of returning a permanent 409 for same hash", async () => {
    const { prisma } = makePostgresLikeHarness();
    const svc = new IdempotencyService(prisma);
    const hash = hashRequestPayload({ name: "Acme" });

    const winner = svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-reconcile",
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId }),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return {
          resourceType: "customer_companies",
          resourceId: "c1",
          result: { id: "c1" },
        };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const loser = svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-reconcile",
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId }),
      execute: async () => ({
        resourceType: "customer_companies",
        resourceId: "c2",
        result: { id: "c2" },
      }),
    });

    const [first, second] = await Promise.all([winner, loser]);
    expect(first.result.id).toBe("c1");
    expect(second.result.id).toBe("c1");
    expect(second.outcome).toBe("replayed");
  });

  it("returns 409 for conflicting hash after winner completes", async () => {
    const { prisma } = makePostgresLikeHarness();
    const svc = new IdempotencyService(prisma);

    await svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-conflict",
      requestHash: hashRequestPayload({ name: "Acme" }),
      load: async (resourceId) => ({ id: resourceId }),
      execute: async () => ({
        resourceType: "customer_companies",
        resourceId: "c1",
        result: { id: "c1" },
      }),
    });

    await expect(
      svc.execute({
        tenantId: "t1",
        scope: "CUSTOMER_ONBOARDING",
        operationKey: "op-conflict",
        requestHash: hashRequestPayload({ name: "Beta" }),
        load: async (resourceId) => ({ id: resourceId }),
        execute: async () => ({
          resourceType: "customer_companies",
          resourceId: "c2",
          result: { id: "c2" },
        }),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("same-key retry after retryable in-progress eventually returns the canonical resource", async () => {
    const { prisma, records } = makePostgresLikeHarness();
    const svc = new IdempotencyService(prisma);
    const hash = hashRequestPayload({ name: "Acme" });
    const key = {
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-retry",
    };

    records.set(`${key.tenantId}\0${key.scope}\0${key.operationKey}`, {
      id: "rec-pending",
      ...key,
      requestHash: hash,
      status: IdempotencyRecordStatus.PENDING,
      resourceType: null,
      resourceId: null,
    });

    const inProgress = svc.execute({
      tenantId: key.tenantId,
      scope: key.scope,
      operationKey: key.operationKey,
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId }),
      execute: async () => ({
        resourceType: "customer_companies",
        resourceId: "c-should-not-run",
        result: { id: "c-should-not-run" },
      }),
    });

    await expect(inProgress).rejects.toBeInstanceOf(ServiceUnavailableException);

    records.set(`${key.tenantId}\0${key.scope}\0${key.operationKey}`, {
      id: "rec-done",
      ...key,
      requestHash: hash,
      status: IdempotencyRecordStatus.COMPLETED,
      resourceType: "customer_companies",
      resourceId: "c-final",
    });

    const replay = await svc.execute({
      tenantId: key.tenantId,
      scope: key.scope,
      operationKey: key.operationKey,
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId }),
      execute: async () => ({
        resourceType: "customer_companies",
        resourceId: "c-new",
        result: { id: "c-new" },
      }),
    });

    expect(replay.result.id).toBe("c-final");
    expect(replay.outcome).toBe("replayed");
  });

  it("rolls back claim and business writes when execute fails", async () => {
    const { prisma, records } = makePostgresLikeHarness();
    const svc = new IdempotencyService(prisma);

    await expect(
      svc.execute({
        tenantId: "t1",
        scope: "CUSTOMER_ONBOARDING",
        operationKey: "op-fail",
        requestHash: hashRequestPayload({ name: "Acme" }),
        load: async (resourceId) => ({ id: resourceId }),
        execute: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");

    expect(records.size).toBe(0);
  });
});

describe("IdempotencyService database integration", () => {
  const enabled = process.env.IDEMPOTENCY_INTEGRATION_DB === "1";

  (enabled ? it : it.skip)(
    "creates one customer row and one completed idempotency record under parallel calls",
    async () => {
      const { PrismaClient, IdempotencyRecordStatus } = await import("@prisma/client");
      const prisma = new PrismaClient();
      const svc = new IdempotencyService(prisma as any);
      const tenant = await prisma.tenant.findFirst();
      if (!tenant) {
        throw new Error("Integration test requires at least one Tenant row");
      }
      const operationKey = `integration-${Date.now()}`;
      const hash = hashRequestPayload({ name: "Integration Customer" });
      let createCount = 0;

      const run = () =>
        svc.execute({
          tenantId: tenant.id,
          scope: "CUSTOMER_ONBOARDING",
          operationKey,
          requestHash: hash,
          load: async (resourceId) =>
            prisma.customer_companies.findFirstOrThrow({
              where: { id: resourceId, tenantId: tenant.id },
            }),
          execute: async (tx) => {
            createCount += 1;
            const created = await tx.customer_companies.create({
              data: {
                tenantId: tenant.id,
                name: `Integration Customer ${operationKey}`,
                normalizedName: `integration-customer-${operationKey}`.toLowerCase(),
                commercialStatus: "PROSPECT",
                isActive: true,
              },
            });
            return {
              resourceType: "customer_companies",
              resourceId: created.id,
              result: created,
            };
          },
        });

      const results = await Promise.all([run(), run(), run()]);
      const record = await prisma.idempotencyRecord.findUnique({
        where: {
          tenantId_scope_operationKey: {
            tenantId: tenant.id,
            scope: "CUSTOMER_ONBOARDING",
            operationKey,
          },
        },
      });

      expect(createCount).toBe(1);
      expect(record?.status).toBe(IdempotencyRecordStatus.COMPLETED);
      expect(new Set(results.map((row) => row.result.id)).size).toBe(1);

      await prisma.idempotencyRecord.deleteMany({
        where: { tenantId: tenant.id, operationKey },
      });
      await prisma.customer_companies.deleteMany({
        where: { tenantId: tenant.id, normalizedName: `integration-customer-${operationKey}`.toLowerCase() },
      });
      await prisma.$disconnect();
    },
  );
});
