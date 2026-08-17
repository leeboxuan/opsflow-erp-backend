import { ConflictException } from "@nestjs/common";
import { IdempotencyRecordStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IdempotencyService } from "./idempotency.service";
import { hashRequestPayload } from "./idempotency.util";

describe("IdempotencyService", () => {
  function makeService(state: {
    records: Array<{
      id?: string;
      tenantId: string;
      scope: string;
      operationKey: string;
      requestHash: string;
      status?: IdempotencyRecordStatus;
      resourceType?: string | null;
      resourceId?: string | null;
    }>;
  }) {
    let nextId = 1;
    const prisma: any = {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
        fn(prisma),
      ),
      idempotencyRecord: {
        findUnique: jest.fn(async ({ where }: any) => {
          const row =
            state.records.find(
              (entry) =>
                entry.tenantId === where.tenantId_scope_operationKey.tenantId &&
                entry.scope === where.tenantId_scope_operationKey.scope &&
                entry.operationKey ===
                  where.tenantId_scope_operationKey.operationKey,
            ) ?? null;
          if (!row) return null;
          return {
            ...row,
            status: row.status ?? IdempotencyRecordStatus.COMPLETED,
          };
        }),
        create: jest.fn(async ({ data }: any) => {
          const duplicate = state.records.some(
            (row) =>
              row.tenantId === data.tenantId &&
              row.scope === data.scope &&
              row.operationKey === data.operationKey,
          );
          if (duplicate) {
            const error: any = new Error("Unique constraint");
            error.code = "P2002";
            error.meta = { target: ["tenantId", "scope", "operationKey"] };
            throw error;
          }
          const row = {
            id: `rec-${nextId++}`,
            status: IdempotencyRecordStatus.PENDING,
            resourceType: null,
            resourceId: null,
            ...data,
          };
          state.records.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.records.find((entry) => entry.id === where.id);
          if (!row) throw new Error("missing record");
          Object.assign(row, data);
          return row;
        }),
      },
    };
    return { svc: new IdempotencyService(prisma), prisma, state };
  }

  it("claims before business work and completes in the same transaction", async () => {
    const { svc, prisma } = makeService({ records: [] });
    const hash = hashRequestPayload({ name: "Acme" });

    const outcome = await svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-1",
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId, name: "Acme" }),
      execute: async () => ({
        resourceType: "customer_companies",
        resourceId: "c1",
        result: { id: "c1", name: "Acme" },
      }),
    });

    expect(outcome.outcome).toBe("created");
    expect(outcome.result.id).toBe("c1");
    expect(prisma.idempotencyRecord.create).toHaveBeenCalled();
    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: IdempotencyRecordStatus.COMPLETED,
          resourceId: "c1",
        }),
      }),
    );
  });

  it("returns the same resource for repeated identical requests", async () => {
    const { svc } = makeService({ records: [] });
    let createCount = 0;
    const hash = hashRequestPayload({ name: "Acme" });

    const first = await svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-1",
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId, name: "Acme" }),
      execute: async () => {
        createCount += 1;
        return {
          resourceType: "customer_companies",
          resourceId: "c1",
          result: { id: "c1", name: "Acme" },
        };
      },
    });
    const second = await svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-1",
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId, name: "Acme" }),
      execute: async () => {
        createCount += 1;
        return {
          resourceType: "customer_companies",
          resourceId: "c2",
          result: { id: "c2", name: "Acme" },
        };
      },
    });

    expect(first.result.id).toBe("c1");
    expect(first.outcome).toBe("created");
    expect(second.result.id).toBe("c1");
    expect(second.outcome).toBe("replayed");
    expect(createCount).toBe(1);
  });

  it("isolates the same operation key across tenants", async () => {
    const { svc } = makeService({ records: [] });
    const hash = hashRequestPayload({ name: "Acme" });

    const t1 = await svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "shared-key",
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId }),
      execute: async () => ({
        resourceType: "customer_companies",
        resourceId: "c-t1",
        result: { id: "c-t1" },
      }),
    });
    const t2 = await svc.execute({
      tenantId: "t2",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "shared-key",
      requestHash: hash,
      load: async (resourceId) => ({ id: resourceId }),
      execute: async () => ({
        resourceType: "customer_companies",
        resourceId: "c-t2",
        result: { id: "c-t2" },
      }),
    });

    expect(t1.result.id).toBe("c-t1");
    expect(t2.result.id).toBe("c-t2");
  });

  it("rejects the same key with a conflicting payload", async () => {
    const { svc } = makeService({ records: [] });

    await svc.execute({
      tenantId: "t1",
      scope: "CUSTOMER_ONBOARDING",
      operationKey: "op-1",
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
        operationKey: "op-1",
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
});

describe("IdempotencyRecord schema and migration", () => {
  const root = join(__dirname, "../../../prisma");
  const schema = readFileSync(join(root, "schema.prisma"), "utf8");
  const migration = readFileSync(
    join(
      root,
      "migrations/20260817140000_onboarding_idempotency_records/migration.sql",
    ),
    "utf8",
  );
  const preflight = readFileSync(
    join(
      root,
      "migrations/20260817140000_onboarding_idempotency_records/preflight.sql",
    ),
    "utf8",
  );

  it("declares bounded columns, status, and tenant-scoped uniqueness", () => {
    expect(schema).toMatch(/enum IdempotencyRecordStatus/);
    expect(schema).toContain('scope        String                  @db.VarChar(64)');
    expect(schema).toContain('operationKey String                  @db.VarChar(128)');
    expect(schema).toContain('requestHash  String                  @db.VarChar(64)');
    expect(schema).toContain("@@unique([tenantId, scope, operationKey])");
    expect(schema).toContain("onDelete: Cascade");
    expect(schema).toMatch(/model IdempotencyRecord \{[\s\S]*?\}/);
    expect(schema).not.toMatch(
      /model IdempotencyRecord \{[\s\S]*?(requestPayload|responsePayload|payloadJson)/,
    );
  });

  it("migration creates enum, indexes, and tenant FK with cascade", () => {
    expect(migration).toContain('CREATE TYPE "IdempotencyRecordStatus"');
    expect(migration).toContain("VARCHAR(64)");
    expect(migration).toContain("VARCHAR(128)");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_records_tenantId_scope_operationKey_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "idempotency_records_tenantId_resourceType_resourceId_idx"',
    );
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "idempotency_records_tenantId_status_claimedAt_idx"',
    );
    expect(migration).toContain('REFERENCES "tenants"("id")');
    expect(migration).not.toContain('REFERENCES "Tenant"("id")');
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain("ON UPDATE CASCADE");
    expect(migration).not.toMatch(/requestPayload|responsePayload|payloadJson/i);
  });

  it("preflight is safe on empty databases", () => {
    expect(preflight).toMatch(/SELECT 1/);
    expect(preflight).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER)\b/i);
  });
});
