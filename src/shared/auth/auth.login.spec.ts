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
    timezone: 'Australia/Perth',
  };

  let controller: AuthController;
  let prisma: {
    user: { findMany: jest.Mock; findUnique: jest.Mock };
    tenantMembership: { findMany: jest.Mock };
    platformAdmin: { findUnique: jest.Mock };
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
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue(null),
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
      role: 'USER',
      isSuperadmin: false,
    });
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.WAREHOUSE,
        status: MembershipStatus.Active,
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
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
    expect(result.activeTenantTimezone).toBe('Australia/Perth');
    expect(JSON.stringify(result)).not.toContain(AUTH_INTERNAL_EMAIL_DOMAIN);
    expect(result.user.roles).toEqual(['WAREHOUSE_STAFF']);
    expect(result.user.role).toBe(Role.WAREHOUSE);
    expect(result.tenantMemberships?.[0]?.roles).toEqual(['WAREHOUSE_STAFF']);
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

  it('treats tenantSlug as an optional membership filter, not a uniqueness domain', async () => {
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

  it('fail-closes if pre-migration duplicate usernames still resolve to multiple users', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-a',
        email: `tenant-a.floor1@${AUTH_INTERNAL_EMAIL_DOMAIN}`,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
      {
        id: 'user-b',
        email: `tenant-b.floor1@${AUTH_INTERNAL_EMAIL_DOMAIN}`,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-b' } },
        ],
      },
    ]);

    await expect(
      controller.login({ username: 'floor1', password: 'secret123' }),
    ).rejects.toThrow('Invalid username or password');
    expect(mockSignIn).not.toHaveBeenCalled();
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

  it('lets a bootstrap-created PlatformAdmin login immediately with zero memberships', async () => {
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
      userId: 'cms-user-1',
      authUserId: '11ed325c-8b25-4fd0-a040-6b4a4a238753',
      email: 'owner@example.com',
      role: 'SUPERADMIN',
      isSuperadmin: true,
      isPlatformAdmin: true,
      platformAdminId: 'pa-boot',
      platformAdminStatus: 'ACTIVE',
    });
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa-boot',
      status: 'ACTIVE',
    });
    prisma.tenantMembership.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      email: 'owner@example.com',
      username: null,
    });

    const result = await controller.login({
      email: 'owner@example.com',
      password: 'secret123',
    });

    expect(authService.verifyToken).toHaveBeenCalledWith('access');
    expect(result.platformAdmin).toEqual({ id: 'pa-boot', status: 'ACTIVE' });
    expect(result.tenantMemberships).toEqual([]);
    expect(result.activeTenantId).toBeNull();
    expect(result.user.role).toBeNull();
  });

  it('returns mapping failure when verifyToken cannot resolve an internal user', async () => {
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
    authService.verifyToken.mockResolvedValue(null);

    await expect(
      controller.login({
        email: 'missing@example.com',
        password: 'secret123',
      }),
    ).rejects.toThrow(/could not find or create internal user/);
  });

  it('allows platform-only admin email login with zero memberships', async () => {
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
      userId: 'pa-user',
      email: 'pa@opsflow.io',
      role: 'SUPERADMIN',
      isSuperadmin: true,
    });
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa-1',
      status: 'ACTIVE',
    });
    prisma.tenantMembership.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      email: 'pa@opsflow.io',
      username: null,
    });

    const result = await controller.login({
      email: 'pa@opsflow.io',
      password: 'secret123',
    });

    expect(result.platformAdmin).toEqual({ id: 'pa-1', status: 'ACTIVE' });
    expect(result.tenantMemberships).toEqual([]);
    expect(result.activeTenantId).toBeNull();
    expect(result.activeTenantTimezone).toBeNull();
  });

  it('rejects platform-only admin on mobile clientApp', async () => {
    await expect(
      controller.login({
        email: 'pa@opsflow.io',
        password: 'secret123',
        clientApp: 'mobile',
      }),
    ).rejects.toThrow('Invalid username or password');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('lets TRANSPORT_DRIVER log into Driver Mobile with username and password', async () => {
    const internalEmail = `tenant-a.ahmad@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-driver',
        email: internalEmail,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);
    mockSuccessfulSession('user-driver', internalEmail);
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.DRIVER,
        status: MembershipStatus.Active,
        membershipRoles: [{ role: 'TRANSPORT_DRIVER' }],
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({
      email: internalEmail,
      username: 'ahmad',
    });

    const result = await controller.login({
      username: 'Ahmad',
      password: 'secret123',
      clientApp: 'driver_mobile',
    });

    expect(mockSignIn).toHaveBeenCalledWith({
      email: internalEmail,
      password: 'secret123',
    });
    expect(result.user.username).toBe('ahmad');
    expect(result.user.email).toBeNull();
    expect(JSON.stringify(result)).not.toContain(AUTH_INTERNAL_EMAIL_DOMAIN);
    expect(result.user.roles).toEqual(['TRANSPORT_DRIVER']);
  });

  it('does not silently choose the first membership for Driver Mobile', async () => {
    const internalEmail = `tenant-a.ahmad@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-ahmad',
        email: internalEmail,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);
    mockSuccessfulSession('user-ahmad', internalEmail);
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.DRIVER,
        status: MembershipStatus.Active,
        membershipRoles: [{ role: 'TRANSPORT_DRIVER' }],
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
      },
      {
        tenantId: 'tenant-b',
        role: Role.DRIVER,
        status: MembershipStatus.Active,
        membershipRoles: [{ role: 'TRANSPORT_DRIVER' }],
        tenant: {
          id: 'tenant-b',
          name: 'Tenant B',
          status: 'ACTIVE',
          timezone: 'Asia/Singapore',
        },
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({
      email: internalEmail,
      username: 'ahmad',
    });

    await expect(
      controller.login({
        username: 'Ahmad',
        password: 'secret123',
        clientApp: 'driver_mobile',
      }),
    ).rejects.toThrow(/more than one company/i);
  });

  it('keeps legacy DRIVER compatible on Driver Mobile', async () => {
    const internalEmail = `tenant-a.legacy@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-legacy',
        email: internalEmail,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);
    mockSuccessfulSession('user-legacy', internalEmail);
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.DRIVER,
        status: MembershipStatus.Active,
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({
      email: internalEmail,
      username: 'legacy',
    });

    const result = await controller.login({
      username: 'legacy',
      password: 'secret123',
      clientApp: 'mobile',
    });
    expect(result.user.roles).toEqual(['TRANSPORT_DRIVER']);
  });

  it('does not accept email-only Driver Mobile login', async () => {
    await expect(
      controller.login({
        email: 'driver@example.com',
        password: 'secret123',
        clientApp: 'driver_mobile',
      }),
    ).rejects.toThrow('Invalid username or password');
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('denies TRANSPORT_DRIVER-only users on staff web', async () => {
    const internalEmail = `tenant-a.ahmad@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-driver',
        email: internalEmail,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);
    mockSuccessfulSession('user-driver', internalEmail);
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.DRIVER,
        status: MembershipStatus.Active,
        membershipRoles: [{ role: 'TRANSPORT_DRIVER' }],
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
      },
    ]);

    await expect(
      controller.login({
        username: 'ahmad',
        password: 'secret123',
        clientApp: 'web',
      }),
    ).rejects.toThrow('This account is for the Driver app only');
  });

  it('denies TRANSPORT_ADMIN-only users on Driver Mobile', async () => {
    mockSuccessfulSession('user-ta', 'ops@example.com');
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.TRANSPORT_STAFF,
        status: MembershipStatus.Active,
        membershipRoles: [{ role: 'TRANSPORT_ADMIN' }],
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-ta',
        email: 'ops@example.com',
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);

    await expect(
      controller.login({
        username: 'ops',
        password: 'secret123',
        clientApp: 'driver_mobile',
      }),
    ).rejects.toThrow('Driver Mobile is only available to Transport Drivers');
  });

  it('denies TENANT_ADMIN-only users on Driver Mobile', async () => {
    mockSuccessfulSession('user-admin', 'admin@example.com');
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.ADMIN,
        status: MembershipStatus.Active,
        membershipRoles: [{ role: 'TENANT_ADMIN' }],
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-admin',
        email: 'admin@example.com',
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);

    await expect(
      controller.login({
        username: 'admin',
        password: 'secret123',
        clientApp: 'driver_mobile',
      }),
    ).rejects.toThrow('Driver Mobile is only available to Transport Drivers');
  });

  it('lets TRANSPORT_DRIVER + TRANSPORT_ADMIN access Driver Mobile and staff web', async () => {
    const internalEmail = `tenant-a.lead@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-both',
        email: internalEmail,
        memberships: [
          { status: MembershipStatus.Active, tenant: { slug: 'tenant-a' } },
        ],
      },
    ]);
    mockSuccessfulSession('user-both', internalEmail);
    prisma.tenantMembership.findMany.mockResolvedValue([
      {
        tenantId: tenantA.id,
        role: Role.TRANSPORT_STAFF,
        status: MembershipStatus.Active,
        membershipRoles: [
          { role: 'TRANSPORT_DRIVER' },
          { role: 'TRANSPORT_ADMIN' },
        ],
        tenant: {
          id: tenantA.id,
          name: tenantA.name,
          status: 'ACTIVE',
          timezone: tenantA.timezone,
        },
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({
      email: internalEmail,
      username: 'lead',
    });

    const mobile = await controller.login({
      username: 'lead',
      password: 'secret123',
      clientApp: 'driver_mobile',
    });
    expect(mobile.user.roles).toEqual(
      expect.arrayContaining(['TRANSPORT_DRIVER', 'TRANSPORT_ADMIN']),
    );

    const web = await controller.login({
      username: 'lead',
      password: 'secret123',
      clientApp: 'web',
    });
    expect(web.user.roles).toEqual(
      expect.arrayContaining(['TRANSPORT_DRIVER', 'TRANSPORT_ADMIN']),
    );
  });

  it('rejects suspended TRANSPORT_DRIVER on Driver Mobile', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-suspended',
        email: `tenant-a.ahmad@${AUTH_INTERNAL_EMAIL_DOMAIN}`,
        memberships: [
          {
            status: MembershipStatus.Suspended,
            tenant: { slug: 'tenant-a' },
          },
        ],
      },
    ]);

    await expect(
      controller.login({
        username: 'ahmad',
        password: 'secret123',
        clientApp: 'driver_mobile',
      }),
    ).rejects.toThrow('Invalid username or password');
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

