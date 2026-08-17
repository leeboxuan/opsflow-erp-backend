import { CustomersService } from "./customers.service";
import { IdempotencyService } from "../shared/idempotency/idempotency.service";
import * as rt from "../shared/realtime/realtime-publish";

describe("CustomersService onboarding post-commit side effects", () => {
  const companyRow = {
    id: "c1",
    tenantId: "t1",
    name: "Acme",
    normalizedName: "acme",
    _count: { contacts: 0, users: 0 },
  };

  function infra() {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === "SUPABASE_PROJECT_URL") return "https://example.supabase.co";
        if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
        return undefined;
      }),
    };
    const supabaseService = { getClient: jest.fn() };
    return { configService, supabaseService };
  }

  function makeService(opts?: {
    realtimeThrows?: boolean;
    executeThrows?: boolean;
  }) {
    const idempotencyRecords: any[] = [];
    let nextId = 1;
    const tx = {
      customer_companies: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async () => {
          if (opts?.executeThrows) {
            throw new Error("db write failed");
          }
          return companyRow;
        }),
      },
    };
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue(companyRow),
      },
      idempotencyRecord: {
        findUnique: jest.fn(async ({ where }: any) =>
          idempotencyRecords.find(
            (row) =>
              row.tenantId === where.tenantId_scope_operationKey.tenantId &&
              row.scope === where.tenantId_scope_operationKey.scope &&
              row.operationKey === where.tenantId_scope_operationKey.operationKey,
          ) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `rec-${nextId++}`, ...data };
          idempotencyRecords.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = idempotencyRecords.find((entry) => entry.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          ...tx,
          idempotencyRecord: prisma.idempotencyRecord,
          customer_companies: tx.customer_companies,
        }),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const realtime = { publish: jest.fn() };
    jest.spyOn(rt, "publishCustomerEvent").mockImplementation(() => {
      if (opts?.realtimeThrows) {
        throw new Error("socket down");
      }
    });
    const { configService, supabaseService } = infra();
    const svc = new CustomersService(
      prisma,
      supabaseService as any,
      configService as any,
      audit as any,
      realtime as any,
      undefined,
      new IdempotencyService(prisma),
    );
    return { svc, audit, idempotencyRecords };
  }

  it("does not emit audit or realtime when the transaction rolls back", async () => {
    const { svc, audit } = makeService({ executeThrows: true });
    await expect(
      svc.createCompany(
        "t1",
        {
          name: "Acme",
          onboardingOperationKey: "op-rollback",
          skipDefaultRateTemplate: true,
        } as any,
        "u1",
      ),
    ).rejects.toThrow("db write failed");
    expect(audit.log).not.toHaveBeenCalled();
    expect(rt.publishCustomerEvent).not.toHaveBeenCalled();
  });

  it("emits exactly one realtime event on first create and none on replay", async () => {
    const { svc } = makeService();
    (rt.publishCustomerEvent as jest.Mock).mockClear();
    await svc.createCompany(
      "t1",
      {
        name: "Acme",
        onboardingOperationKey: "op-once",
        skipDefaultRateTemplate: true,
      } as any,
      "u1",
    );
    await svc.createCompany(
      "t1",
      {
        name: "Acme",
        onboardingOperationKey: "op-once",
        skipDefaultRateTemplate: true,
      } as any,
      "u1",
    );
    expect(rt.publishCustomerEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed customer when tolerated side effects fail", async () => {
    const { svc, idempotencyRecords } = makeService({ realtimeThrows: true });
    (rt.publishCustomerEvent as jest.Mock).mockClear();
    const created = await svc.createCompany(
      "t1",
      {
        name: "Acme",
        onboardingOperationKey: "op-side-effect-fail",
        skipDefaultRateTemplate: true,
      } as any,
      "u1",
    );
    expect(created.id).toBe("c1");
    expect(idempotencyRecords.some((row) => row.status === "COMPLETED")).toBe(true);
    expect(rt.publishCustomerEvent).toHaveBeenCalledTimes(1);
  });
});
