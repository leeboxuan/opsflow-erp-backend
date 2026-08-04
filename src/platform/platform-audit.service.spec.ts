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
