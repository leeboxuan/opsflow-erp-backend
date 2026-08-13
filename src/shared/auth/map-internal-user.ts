/**
 * Map a verified Supabase Auth subject to public.users.
 * Primary key is JWT `sub` === User.authUserId. Email is only required for
 * legacy backfill and first-login auto-create of tenant users.
 * Platform-only users (zero TenantMembership) map the same way.
 */

export type InternalUserRow = {
  id: string;
  email: string;
  authUserId: string | null;
  role: string | null;
};

type UserDelegate = {
  findFirst: (args: {
    where: { authUserId?: string; email?: string };
  }) => Promise<InternalUserRow | null>;
  create: (args: {
    data: {
      authUserId: string;
      email: string;
      name: string;
      role: string;
    };
  }) => Promise<InternalUserRow>;
  update: (args: {
    where: { id: string };
    data: { authUserId?: string; role?: string };
  }) => Promise<InternalUserRow>;
};

export function jwtEmailFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    email?: unknown;
    user_metadata?: { email?: unknown } | null;
  };
  const direct = typeof record.email === "string" ? record.email.trim() : "";
  if (direct) return direct;
  const meta =
    record.user_metadata && typeof record.user_metadata.email === "string"
      ? record.user_metadata.email.trim()
      : "";
  return meta || null;
}

export async function mapSupabaseSubjectToInternalUser(
  prisma: { user: UserDelegate | Record<string, unknown> },
  params: { authUserId: string; email?: string | null },
): Promise<InternalUserRow | null> {
  const users = prisma.user as UserDelegate;
  const authUserId = String(params.authUserId || "").trim();
  if (!authUserId) return null;

  let user = await users.findFirst({
    where: { authUserId },
  });

  const email = params.email?.trim() || null;

  if (!user && email) {
    user = await users.findFirst({
      where: { email },
    });
  }

  if (!user) {
    if (!email) return null;
    return users.create({
      data: {
        authUserId,
        email,
        name: email,
        role: "USER",
      },
    });
  }

  const updates: { authUserId?: string; role?: string } = {};
  if (!user.authUserId) {
    updates.authUserId = authUserId;
  }
  if (!user.role) {
    updates.role = "USER";
  }
  if (Object.keys(updates).length === 0) {
    return user;
  }
  return users.update({
    where: { id: user.id },
    data: updates,
  });
}
