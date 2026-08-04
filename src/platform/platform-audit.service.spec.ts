import { PlatformAuditService } from "./platform-audit.service";

describe("PlatformAuditService.redactMetadata", () => {
  const svc = new PlatformAuditService({} as any);

  it("redacts secret-like keys", () => {
    const out = svc.redactMetadata({
      password: "secret",
      name: "ok",
      refreshToken: "x",
    });
    expect(out.password).toBe("[REDACTED]");
    expect(out.refreshToken).toBe("[REDACTED]");
    expect(out.name).toBe("ok");
  });
});

describe("PlatformAuditService transaction helpers", () => {
  it("appendInTx writes through provided client", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a1" });
    const svc = new PlatformAuditService({} as any);
    await svc.appendInTx(
      { platformAuditLog: { create } },
      {
        actorPlatformAdminId: "pa-1",
        actorUserId: "u-1",
        action: "TENANT_SUSPEND",
        targetTenantId: "t-1",
        entityType: "Tenant",
        entityId: "t-1",
        reason: "ops",
        metadata: { password: "nope", outcome: "success" },
      },
    );
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.action).toBe("TENANT_SUSPEND");
    expect(data.metadata.password).toBe("[REDACTED]");
    expect(data.metadata.outcome).toBe("success");
  });

  it("runWithRequiredAudit rolls back domain when audit fails", async () => {
    const domain = jest.fn().mockResolvedValue({ ok: true });
    const create = jest.fn().mockRejectedValue(new Error("audit down"));
    const prisma = {
      $transaction: jest.fn(async (fn: any) => {
        const tx = { platformAuditLog: { create } };
        return fn(tx);
      }),
    };
    const svc = new PlatformAuditService(prisma as any);
    await expect(
      svc.runWithRequiredAudit(
        {
          actorPlatformAdminId: "pa-1",
          actorUserId: "u-1",
          action: "TENANT_UPDATE",
          targetTenantId: "t-1",
        },
        domain,
      ),
    ).rejects.toThrow(/audit down/);
    expect(domain).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it("runWithRequiredAudit commits domain + audit together on success", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a1" });
    const prisma = {
      $transaction: jest.fn(async (fn: any) => {
        const tx = { platformAuditLog: { create } };
        return fn(tx);
      }),
    };
    const svc = new PlatformAuditService(prisma as any);
    const result = await svc.runWithRequiredAudit(
      {
        actorPlatformAdminId: "pa-1",
        actorUserId: "u-1",
        action: "TENANT_CREATE",
        targetTenantId: "t-1",
        entityId: "t-1",
      },
      async () => ({ id: "t-1" }),
    );
    expect(result).toEqual({ id: "t-1" });
    expect(create).toHaveBeenCalled();
  });

  it("reconciliationRequiredError exposes stable code", () => {
    const svc = new PlatformAuditService({} as any);
    const err = svc.reconciliationRequiredError();
    const body = (err as any).getResponse?.() ?? (err as any).response;
    expect(body.code).toBe("PLATFORM_AUDIT_RECONCILIATION_REQUIRED");
    expect(body.reconciliationRequired).toBe(true);
  });
});
