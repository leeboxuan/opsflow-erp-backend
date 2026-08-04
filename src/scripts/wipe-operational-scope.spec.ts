import {
  parseWipeScopeArgs,
  resolveWipeScope,
  type WipeScopeResult,
} from "./wipe-operational-scope";

function expectWipeScopeError(
  result: WipeScopeResult,
  pattern: RegExp,
): asserts result is { ok: false; error: string } {
  expect(result.ok).toBe(false);
  if (result.ok !== false) {
    throw new Error("expected wipe scope resolution to fail");
  }
  expect(result.error).toMatch(pattern);
}

describe("wipe operational scope", () => {
  it("rejects when neither TENANT_ID nor --all-tenants is supplied", () => {
    const result = resolveWipeScope(
      { allTenants: false },
      { TENANT_ID: undefined, WIPE_ALL_TENANTS: undefined },
    );
    expectWipeScopeError(result, /TENANT_ID/);
    expect(result.error).toMatch(/--all-tenants/);
  });

  it("rejects both TENANT_ID and --all-tenants", () => {
    const result = resolveWipeScope(
      { allTenants: true },
      { TENANT_ID: "tenant-1", WIPE_ALL_TENANTS: "true" },
    );
    expectWipeScopeError(result, /not both/i);
  });

  it("rejects --all-tenants without WIPE_ALL_TENANTS=true", () => {
    const result = resolveWipeScope(
      { allTenants: true },
      { TENANT_ID: undefined, WIPE_ALL_TENANTS: "false" },
    );
    expectWipeScopeError(result, /WIPE_ALL_TENANTS=true/);
  });

  it("rejects WIPE_ALL_TENANTS=true without --all-tenants", () => {
    const result = resolveWipeScope(
      { allTenants: false },
      { TENANT_ID: undefined, WIPE_ALL_TENANTS: "true" },
    );
    expectWipeScopeError(result, /--all-tenants/);
  });

  it("accepts tenant-scoped wipe with TENANT_ID only", () => {
    const result = resolveWipeScope(
      { allTenants: false },
      { TENANT_ID: "  tenant-abc  ", WIPE_ALL_TENANTS: undefined },
    );
    expect(result).toEqual({ ok: true, mode: "tenant", tenantId: "tenant-abc" });
  });

  it("accepts all-tenant wipe with flag + env", () => {
    const result = resolveWipeScope(
      { allTenants: true },
      { TENANT_ID: undefined, WIPE_ALL_TENANTS: "true" },
    );
    expect(result).toEqual({ ok: true, mode: "all-tenants" });
  });

  it("parseWipeScopeArgs detects --all-tenants", () => {
    expect(parseWipeScopeArgs(["--dry-run"]).allTenants).toBe(false);
    expect(parseWipeScopeArgs(["--all-tenants", "--dry-run"]).allTenants).toBe(true);
  });

  it("does not infer all-tenants from empty TENANT_ID string", () => {
    const result = resolveWipeScope(
      { allTenants: false },
      { TENANT_ID: "   ", WIPE_ALL_TENANTS: undefined },
    );
    expectWipeScopeError(result, /TENANT_ID/);
  });

  it("dry-run uses the same resolution rules (missing TENANT_ID never becomes all-tenants)", () => {
    // Dry-run does not change resolveWipeScope — same fail-closed matrix.
    const dryRunLike = resolveWipeScope(
      { allTenants: false },
      { TENANT_ID: undefined, WIPE_ALL_TENANTS: undefined },
    );
    expectWipeScopeError(dryRunLike, /TENANT_ID/);
    expect(dryRunLike.error).not.toMatch(/all tenants in DB/i);
  });
});
