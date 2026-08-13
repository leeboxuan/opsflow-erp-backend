import {
  projectRefFromSupabaseUrl,
  resolveSupabaseJwtIssuer,
} from "./supabase-jwt-issuer";

describe("resolveSupabaseJwtIssuer", () => {
  it("prefers SUPABASE_PROJECT_URL over a disagreeing PROJECT_REF", () => {
    const resolved = resolveSupabaseJwtIssuer({
      SUPABASE_PROJECT_URL: "https://rzvayccekcmkpwfyxuzi.supabase.co",
      SUPABASE_PROJECT_REF: "qaqmseqfotymmwkmzjsp",
    });
    expect(resolved.projectRef).toBe("rzvayccekcmkpwfyxuzi");
    expect(resolved.issuer).toBe(
      "https://rzvayccekcmkpwfyxuzi.supabase.co/auth/v1",
    );
    expect(resolved.jwksUrl).toBe(
      "https://rzvayccekcmkpwfyxuzi.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });

  it("falls back to PROJECT_REF when URL is missing", () => {
    const resolved = resolveSupabaseJwtIssuer({
      SUPABASE_PROJECT_REF: "qaqmseqfotymmwkmzjsp",
    });
    expect(resolved.projectRef).toBe("qaqmseqfotymmwkmzjsp");
  });

  it("throws when neither URL nor ref is set", () => {
    expect(() => resolveSupabaseJwtIssuer({})).toThrow(/must be configured/);
  });

  it("parses project ref from supabase URL", () => {
    expect(
      projectRefFromSupabaseUrl("https://abc123.supabase.co"),
    ).toBe("abc123");
  });
});
