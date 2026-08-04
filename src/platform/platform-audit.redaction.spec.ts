import { PlatformAuditService } from "./platform-audit.service";

describe("PlatformAuditService Phase 4 redaction", () => {
  const svc = new PlatformAuditService({} as any);

  it("redacts signedUrl, tokens, and JWT-shaped strings", () => {
    const out = svc.redactMetadata({
      signedUrl: "https://x/y?token=abc",
      previewUrl: "https://storage.example/file?token=abc",
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig",
      name: "ok",
    });
    expect(out.signedUrl).toBe("[REDACTED]");
    expect(out.previewUrl).toBe("[REDACTED_URL_OR_TOKEN]");
    expect(out.jwt).toBe("[REDACTED_URL_OR_TOKEN]");
    expect(out.name).toBe("ok");
  });
});
