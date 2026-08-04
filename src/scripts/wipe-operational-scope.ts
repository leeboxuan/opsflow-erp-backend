/**
 * Pure scope-resolution helpers for wipe-operational-data.ts.
 * Fail-closed: all-tenant wipe is never inferred from a missing TENANT_ID.
 */

export type WipeScopeCliFlags = {
  allTenants: boolean;
};

export type WipeScopeEnv = {
  TENANT_ID?: string | null;
  WIPE_ALL_TENANTS?: string | null;
};

export type WipeScopeResult =
  | { ok: true; mode: "tenant"; tenantId: string }
  | { ok: true; mode: "all-tenants" }
  | { ok: false; error: string };

export function parseWipeScopeArgs(argv: string[]): WipeScopeCliFlags {
  let allTenants = false;
  for (const arg of argv) {
    if (arg === "--all-tenants") allTenants = true;
  }
  return { allTenants };
}

/**
 * Resolve wipe tenant scope. Must be called before any DB writes (including dry-run counts).
 */
export function resolveWipeScope(
  flags: WipeScopeCliFlags,
  env: WipeScopeEnv = {
    TENANT_ID: process.env.TENANT_ID,
    WIPE_ALL_TENANTS: process.env.WIPE_ALL_TENANTS,
  },
): WipeScopeResult {
  const tenantId = String(env.TENANT_ID ?? "").trim() || null;
  const wipeAllEnv = String(env.WIPE_ALL_TENANTS ?? "").trim() === "true";
  const allTenantsFlag = flags.allTenants === true;

  if (tenantId && allTenantsFlag) {
    return {
      ok: false,
      error:
        "Refusing: supply either TENANT_ID=<id> or --all-tenants, not both.",
    };
  }

  if (!tenantId && !allTenantsFlag) {
    return {
      ok: false,
      error:
        "Refusing: set TENANT_ID=<exact tenant ID> for a tenant-scoped wipe, " +
        "or pass --all-tenants with WIPE_ALL_TENANTS=true for an all-tenant wipe.",
    };
  }

  if (allTenantsFlag && !wipeAllEnv) {
    return {
      ok: false,
      error:
        "Refusing: --all-tenants requires WIPE_ALL_TENANTS=true.",
    };
  }

  if (wipeAllEnv && !allTenantsFlag) {
    return {
      ok: false,
      error:
        "Refusing: WIPE_ALL_TENANTS=true requires the --all-tenants flag.",
    };
  }

  if (allTenantsFlag && wipeAllEnv) {
    return { ok: true, mode: "all-tenants" };
  }

  return { ok: true, mode: "tenant", tenantId: tenantId! };
}
