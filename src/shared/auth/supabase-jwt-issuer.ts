/**
 * JWT issuer / JWKS must come from the same Supabase project used for login
 * (SUPABASE_PROJECT_URL). A leftover SUPABASE_PROJECT_REF from another env file
 * must not silently point verification at a different project.
 */

export type SupabaseJwtEnv = {
  SUPABASE_PROJECT_URL?: string | null;
  SUPABASE_URL?: string | null;
  SUPABASE_PROJECT_REF?: string | null;
};

export type SupabaseJwtIssuer = {
  issuer: string;
  jwksUrl: string;
  projectRef: string;
};

const REF_FROM_URL = /^https?:\/\/([^.]+)\.supabase\.co/i;

export function projectRefFromSupabaseUrl(url: string): string | null {
  const match = String(url || "").trim().match(REF_FROM_URL);
  return match ? match[1] : null;
}

export function resolveSupabaseJwtIssuer(env: SupabaseJwtEnv): SupabaseJwtIssuer {
  const projectUrl = String(
    env.SUPABASE_PROJECT_URL || env.SUPABASE_URL || "",
  ).trim();
  const urlRef = projectUrl ? projectRefFromSupabaseUrl(projectUrl) : null;
  const explicitRef = String(env.SUPABASE_PROJECT_REF || "").trim() || null;

  const projectRef = urlRef || explicitRef;
  if (!projectRef) {
    throw new Error(
      "SUPABASE_PROJECT_URL or SUPABASE_PROJECT_REF must be configured",
    );
  }
  if (projectUrl && !urlRef) {
    throw new Error(
      "Invalid SUPABASE_PROJECT_URL format. Expected: https://<ref>.supabase.co",
    );
  }

  const issuer = `https://${projectRef}.supabase.co/auth/v1`;
  return {
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    projectRef,
  };
}
