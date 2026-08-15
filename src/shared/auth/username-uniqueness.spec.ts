import { ConflictException } from '@nestjs/common';
import { normalizeUsername } from './auth-internal-email';
import {
  USERNAME_NORMALIZED_INDEX,
  USERNAME_NORMALIZED_PG_SQL,
  USERNAME_TAKEN_MESSAGE,
  assertUsernameGloballyAvailable,
  findUsernameLoginCandidates,
  isPrismaUsernameUniqueConflict,
  rethrowUsernameUniqueConflict,
} from './username-uniqueness';

describe('username uniqueness', () => {
  it('uses the same canonical form for create and login', () => {
    expect(normalizeUsername('  Ahmad  ')).toBe('ahmad');
    expect(normalizeUsername('Ahmad')).toBe(normalizeUsername('ahmad'));
    expect(normalizeUsername('Lee Bo')).toBe(normalizeUsername('leebo'));
    expect(normalizeUsername('Driver.One')).toBe('driver.one');
    expect(normalizeUsername('driver.one')).toBe('driver.one');
    expect(normalizeUsername('driver one')).toBe('driverone');
    expect(normalizeUsername('driverone')).toBe('driverone');
    expect(normalizeUsername('\tdriver.one\n')).toBe('driver.one');
  });

  it('documents the PostgreSQL expression used by the unique index', () => {
    expect(USERNAME_NORMALIZED_PG_SQL).toContain("[[:space:]]+");
    expect(USERNAME_NORMALIZED_PG_SQL).toContain('lower(');
    expect(USERNAME_NORMALIZED_INDEX).toBe('users_username_normalized_key');
  });

  it('treats case and whitespace equivalents as the same username', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'u-other' }),
      },
    };
    await expect(
      assertUsernameGloballyAvailable(prisma as any, '  Ahmad '),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { username: 'ahmad' },
      select: { id: true },
    });
  });

  it('uses the SQL expression when $queryRaw is available', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'u-other' }]),
      user: { findFirst: jest.fn() },
    };
    await expect(
      assertUsernameGloballyAvailable(prisma as any, 'Driver.One'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('allows null-equivalent absence: empty lookup is not performed for unused usernames', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    await expect(
      assertUsernameGloballyAvailable(prisma as any, 'office.user'),
    ).resolves.toBe('office.user');
  });

  it('recognizes Prisma unique races on username and the functional index name', () => {
    expect(
      isPrismaUsernameUniqueConflict({
        code: 'P2002',
        meta: { target: ['username'] },
      }),
    ).toBe(true);
    expect(
      isPrismaUsernameUniqueConflict({
        code: 'P2002',
        meta: { target: [USERNAME_NORMALIZED_INDEX] },
      }),
    ).toBe(true);
    expect(
      isPrismaUsernameUniqueConflict({
        code: 'P2002',
        meta: { constraint: USERNAME_NORMALIZED_INDEX, target: [] },
      }),
    ).toBe(true);
    expect(
      isPrismaUsernameUniqueConflict({
        code: '23505',
        message: `duplicate key value violates unique constraint "${USERNAME_NORMALIZED_INDEX}"`,
      }),
    ).toBe(true);
    expect(
      isPrismaUsernameUniqueConflict({
        code: 'P2002',
        meta: { target: ['email'] },
      }),
    ).toBe(false);
    expect(
      isPrismaUsernameUniqueConflict({
        code: 'P2002',
        meta: { target: [] },
        message: 'Unique constraint failed',
      }),
    ).toBe(false);
    expect(
      isPrismaUsernameUniqueConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint "users_email_key"',
      }),
    ).toBe(false);
    expect(USERNAME_TAKEN_MESSAGE).not.toContain('@');
  });

  it('converts username unique races to a stable 409 without leaking internals', () => {
    expect(() =>
      rethrowUsernameUniqueConflict({
        code: 'P2002',
        meta: { target: [USERNAME_NORMALIZED_INDEX] },
        message: 'Unique constraint failed on acme.ahmad@auth.opsflow.app',
      }),
    ).toThrow(USERNAME_TAKEN_MESSAGE);
    expect(() =>
      rethrowUsernameUniqueConflict({
        code: 'P2002',
        meta: { target: ['email'] },
      }),
    ).not.toThrow();
  });

  it('looks up login candidates with the same normalized identity', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'user-1',
          email: 'hidden@example.com',
          memberships: [{ status: 'Active', slug: 'acme' }],
        },
      ]),
    };
    const rows = await findUsernameLoginCandidates(
      prisma as any,
      '  Driver.One  ',
    );
    expect(rows[0]?.id).toBe('user-1');
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});
