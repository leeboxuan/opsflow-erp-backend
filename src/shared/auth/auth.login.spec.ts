import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembershipStatus, Role } from '@prisma/client';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_INTERNAL_EMAIL_DOMAIN } from './auth-internal-email';

const mockSignIn = jest.fn();
const mockCreateClient = jest.fn(() => ({
  auth: { signInWithPassword: mockSignIn },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) =>
    (mockCreateClient as (...a: unknown[]) => unknown)(...args),
}));

describe('AuthController.login', () => {
  const tenantA = {
    id: 'tenant-a',
    name: 'Tenant A',
    slug: 'tenant-a',
  };

  let controller: AuthController;
  let prisma: {
    user: { findMany: jest.Mock; findUnique: jest.Mock };
    tenantMembership: { findMany: jest.Mock };
  };
  let authService: { verifyToken: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignIn.mockReset();
    mockCreateClient.mockClear();

    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      tenantMembership: {
        findMany: jest.fn(),
      },
    };

    authService = {
      verifyToken: jest.fn(),
    };

    config = {
      get: jest.fn((key: string) => {
        if (key === 'SUPABASE_PROJECT_URL' || key === 'SUPABASE_URL') {
          return 'https://example.supabase.co';
        }
        if (key === 'SUPABASE_ANON_KEY') return 'anon-key';
        if (key === 'SUPABASE_JWT_SECRET') return 'jwt-secret';
        return undefined;
      }),
    };

    controller = new AuthController(
      authService as unknown as AuthService,
      {} as SupabaseService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  function mockSuccessfulSession(userId: string, email: string) {
    mockSignIn.mockResolvedValue({
      data: {
        session: {
          access_token: 'access',
          refresh_token: 'refresh',
          expires_at: 123,
        },
      },
      error: null,
    });
    authService.verifyToken.mockResolvedValue({
      userId,
      email,
    });
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.WAREHOUSE,
        status: MembershipStatus.Active,
        tenant: { id: tenantA.id, name: tenantA.name },
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({
      email,
      username: 'floor1',
    });
  }

  it('logs in with username and does not expose internal email', async () => {
    const internalEmail = `tenant-a.floor1@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: internalEmail,
        memberships: [
          {
            status: MembershipStatus.Active,
            tenant: { slug: 'tenant-a' },
          },
        ],
      },
    ]);
    mockSuccessfulSession('user-1', internalEmail);

    const result = await controller.login({
      username: 'Floor1',
      password: 'secret123',
      tenantSlug: 'tenant-a',
    });

    expect(mockSignIn).toHaveBeenCalledWith({
      email: internalEmail,
      password: 'secret123',
    });
    expect(result.user.email).toBeNull();
    expect(result.user.username).toBe('floor1');
    expect(JSON.stringify(result)).not.toContain(AUTH_INTERNAL_EMAIL_DOMAIN);
  });

  it('normalizes username before lookup', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await expect(
      controller.login({
        username: '  Floor.One  ',
        password: 'x',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ username: 'floor.one' }),
      }),
    );
  });

  it('allows the same username in different tenants via tenantSlug', async () => {
    const emailB = `tenant-b.floor1@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-b',
        email: emailB,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-b' } },
        ],
      },
    ]);
    mockSuccessfulSession('user-b', emailB);
    prisma.user.findUnique.mockResolvedValue({
      email: emailB,
      username: 'floor1',
    });

    await controller.login({
      username: 'floor1',
      tenantSlug: 'tenant-b',
      password: 'secret123',
    });

    expect(mockSignIn).toHaveBeenCalledWith({
      email: emailB,
      password: 'secret123',
    });
  });

  it('rejects incorrect password with generic username error', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: `tenant-a.floor1@${AUTH_INTERNAL_EMAIL_DOMAIN}`,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);
    mockSignIn.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    });

    await expect(
      controller.login({ username: 'floor1', password: 'wrong' }),
    ).rejects.toThrow('Invalid username or password');
  });

  it('rejects unknown username with generic error', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await expect(
      controller.login({ username: 'missing', password: 'x' }),
    ).rejects.toThrow('Invalid username or password');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('rejects inactive username users with generic error', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: `tenant-a.floor1@${AUTH_INTERNAL_EMAIL_DOMAIN}`,
        memberships: [
          {
            status: MembershipStatus.Suspended,
            tenant: { slug: 'tenant-a' },
          },
        ],
      },
    ]);

    await expect(
      controller.login({ username: 'floor1', password: 'secret123' }),
    ).rejects.toThrow('Invalid username or password');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('keeps email login compatible', async () => {
    mockSuccessfulSession('user-email', 'ops@example.com');
    prisma.user.findUnique.mockResolvedValue({
      email: 'ops@example.com',
      username: null,
    });
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.TRANSPORT_STAFF,
        status: MembershipStatus.Active,
        tenant: { id: tenantA.id, name: tenantA.name },
      },
    ]);

    const result = await controller.login({
      email: 'ops@example.com',
      password: 'secret123',
    });

    expect(mockSignIn).toHaveBeenCalledWith({
      email: 'ops@example.com',
      password: 'secret123',
    });
    expect(result.user.email).toBe('ops@example.com');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
