import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeUsername } from './auth-internal-email';

export const USERNAME_TAKEN_MESSAGE = 'Username is already taken';

/**
 * Functional unique index name created by
 * prisma/migrations/20260815120000_users_username_global_unique.
 */
export const USERNAME_NORMALIZED_INDEX = 'users_username_normalized_key';

/**
 * Canonical username contract (create, login, uniqueness, audit SQL):
 *
 * JavaScript (`normalizeUsername`):
 *   String(raw).trim().toLowerCase().replace(/\s+/g, '')
 *
 * PostgreSQL (same practical ASCII identity):
 *   lower(regexp_replace("username", '[[:space:]]+', '', 'g'))
 *
 * Equivalence examples (must collide):
 *   Driver.One / driver.one
 *   driver one / driverone
 *   leading/trailing whitespace variants
 *
 * Unicode difference (not claimed equivalent):
 *   JS `\s` includes Unicode separators such as NBSP (U+00A0) and some
 *   Zs characters. POSIX `[[:space:]]` is locale POSIX whitespace
 *   (typically ASCII space/tab/LF/CR/FF/VT). OpsFlow usernames are
 *   ASCII identifiers (`[a-z0-9._-]` after normalize).
 *
 * NULL usernames are excluded from the unique index (email-only users).
 * The application persists the JS canonical form and does not rewrite
 * existing rows. Login lookup uses the PostgreSQL expression so
 * already-stored mixed-case/whitespace values still resolve.
 */
export const USERNAME_NORMALIZED_PG_SQL =
  `lower(regexp_replace("username", '[[:space:]]+', '', 'g'))`;

export function throwUsernameTaken(): never {
  throw new ConflictException(USERNAME_TAKEN_MESSAGE);
}

export function prismaUniqueTargetFields(err: unknown): string[] {
  const meta = (err as { meta?: { target?: unknown } } | null)?.meta;
  const target = meta?.target;
  if (Array.isArray(target)) {
    return target.map((value) => String(value));
  }
  if (typeof target === 'string') {
    return [target];
  }
  return [];
}

function constraintOrIndexNames(err: unknown): string[] {
  const meta = (err as { meta?: Record<string, unknown> } | null)?.meta;
  const names: string[] = [];
  if (!meta) return names;
  for (const key of ['constraint', 'driverAdapterError', 'table'] as const) {
    const value = meta[key];
    if (typeof value === 'string') names.push(value);
  }
  return names;
}

function mentionsNormalizedUsernameIndex(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(USERNAME_NORMALIZED_INDEX.toLowerCase()) ||
    (lower.includes('users_username') &&
      lower.includes('normalized') &&
      !lower.includes('email'))
  );
}

/**
 * True only when the failure is the username uniqueness index.
 * Prisma P2002 `meta.target` is unreliable for functional indexes
 * (often the index name, sometimes empty). Do not treat generic
 * unique failures as "username taken".
 */
export function isPrismaUsernameUniqueConflict(err: unknown): boolean {
  const code = String((err as { code?: string } | null)?.code ?? '');
  const message = String((err as { message?: string } | null)?.message ?? '');
  const fields = prismaUniqueTargetFields(err).map((field) =>
    field.toLowerCase(),
  );
  const names = constraintOrIndexNames(err).map((value) => value.toLowerCase());
  const haystack = [...fields, ...names];

  const namedUsernameIndex = haystack.some(
    (value) =>
      value === 'username' ||
      value === USERNAME_NORMALIZED_INDEX.toLowerCase() ||
      value === `"${USERNAME_NORMALIZED_INDEX.toLowerCase()}"`,
  );

  if (code === 'P2002') {
    if (fields.some((field) => field === 'email' || field.endsWith('.email'))) {
      return false;
    }
    if (namedUsernameIndex) return true;
    if (fields.length === 0 && mentionsNormalizedUsernameIndex(message)) {
      return true;
    }
    return false;
  }

  // Postgres unique_violation, including some Prisma unknown/driver wraps.
  if (code === '23505' || /unique constraint/i.test(message)) {
    return mentionsNormalizedUsernameIndex(`${message} ${haystack.join(' ')}`);
  }

  return mentionsNormalizedUsernameIndex(`${message} ${haystack.join(' ')}`);
}

export function rethrowUsernameUniqueConflict(err: unknown): void {
  if (isPrismaUsernameUniqueConflict(err)) {
    throwUsernameTaken();
  }
}

export type UsernameLoginCandidate = {
  id: string;
  email: string;
  memberships: Array<{ status: string; tenant?: { slug: string | null } }>;
};

function mapRawUsernameRows(rows: unknown[]): UsernameLoginCandidate[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const record = row as {
      id: string;
      email: string;
      memberships?: unknown;
    };
    let memberships = record.memberships;
    if (typeof memberships === 'string') {
      try {
        memberships = JSON.parse(memberships);
      } catch {
        memberships = [];
      }
    }
    const list = Array.isArray(memberships) ? memberships : [];
    return {
      id: record.id,
      email: record.email,
      memberships: list.map((item: any) => ({
        status: String(item?.status ?? ''),
        tenant: { slug: item?.slug ?? item?.tenant?.slug ?? null },
      })),
    };
  });
}

export async function findUsernameLoginCandidates(
  prisma: any,
  rawUsername: string,
  tenantSlug?: string | null,
): Promise<UsernameLoginCandidate[]> {
  const username = normalizeUsername(rawUsername);
  if (!username) return [];
  const slug = tenantSlug?.trim().toLowerCase() || null;

  if (typeof prisma.$queryRaw === 'function') {
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT u.id, u.email,
        COALESCE(
          json_agg(
            json_build_object('status', m.status, 'slug', t.slug)
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'::json
        ) AS memberships
      FROM users u
      LEFT JOIN tenant_memberships m ON m."userId" = u.id
      LEFT JOIN tenants t ON t.id = m."tenantId"
      WHERE u.username IS NOT NULL
        AND lower(regexp_replace(u.username, '[[:space:]]+', '', 'g')) = ${username}
        AND (${slug}::text IS NULL OR t.slug = ${slug})
      GROUP BY u.id, u.email
      LIMIT 5
    `);
    return mapRawUsernameRows(rows as unknown[]);
  }

  const candidates = await prisma.user.findMany({
    where: {
      username,
      memberships: {
        some: {
          ...(slug ? { tenant: { slug } } : {}),
        },
      },
    },
    select: {
      id: true,
      email: true,
      memberships: {
        where: slug ? { tenant: { slug } } : undefined,
        select: {
          status: true,
          tenant: { select: { slug: true } },
        },
      },
    },
    take: 5,
  });
  return candidates as UsernameLoginCandidate[];
}

export async function assertUsernameGloballyAvailable(
  prisma: any,
  rawUsername: string,
  excludeUserId?: string,
): Promise<string> {
  const username = normalizeUsername(rawUsername);

  if (typeof prisma.$queryRaw === 'function') {
    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT id
      FROM users
      WHERE username IS NOT NULL
        AND lower(regexp_replace(username, '[[:space:]]+', '', 'g')) = ${username}
        AND (${excludeUserId ?? null}::text IS NULL OR id <> ${excludeUserId ?? null})
      LIMIT 1
    `)) as Array<{ id: string }>;
    if (rows?.length) {
      throwUsernameTaken();
    }
    return username;
  }

  const existing = await prisma.user.findFirst({
    where: {
      username,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throwUsernameTaken();
  }
  return username;
}
