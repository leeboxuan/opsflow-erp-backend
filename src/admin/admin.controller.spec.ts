import { BadRequestException } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import { AdminController } from './admin.controller';
import { TenantUserProvisioningService } from './tenant-user-provisioning.service';

describe('AdminController users', () => {
  function makeController() {
    const prisma: any = {
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === 'function') return arg(prisma);
        return Promise.all(arg);
      }),
      tenantMembership: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm-ops',
            role: Role.TRANSPORT_STAFF,
            status: MembershipStatus.Active,
            user: {
              id: 'u-ops',
              email: 'ops@example.com',
              username: null,
              name: 'Ops User',
              phone: '+6512345678',
              createdAt: new Date('2026-07-01T00:00:00.000Z'),
              updatedAt: new Date('2026-07-01T00:00:00.000Z'),
            },
          },
          {
            id: 'm-wh',
            role: Role.WAREHOUSE,
            status: MembershipStatus.Active,
            user: {
              id: 'u-wh',
              email: `tenant-a.floor1@auth.opsflow.app`,
              username: 'floor1',
              name: 'Warehouse User',
              phone: null,
              createdAt: new Date('2026-07-01T00:00:00.000Z'),
              updatedAt: new Date('2026-07-01T00:00:00.000Z'),
            },
          },
        ]),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ slug: 'tenant-a' }),
      },
      customer_companies: { upsert: jest.fn() },
      customer_contacts: { upsert: jest.fn() },
    };

    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        auth: {
          admin: {
            inviteUserByEmail: jest.fn().mockResolvedValue({ error: null }),
            createUser: jest.fn().mockResolvedValue({
              data: { user: { id: 'auth-1' } },
              error: null,
            }),
            updateUserById: jest.fn().mockResolvedValue({ error: null }),
            deleteUser: jest.fn().mockResolvedValue({ error: null }),
          },
        },
      }),
    };

    const tenantUsers = new TenantUserProvisioningService(
      prisma,
      supabaseService,
    );

    const controller = new AdminController(
      prisma,
      {} as any,
      supabaseService,
      tenantUsers,
    );

    return { controller, prisma, supabaseService };
  }

  it('lists users filtered by OPS,WAREHOUSE (expands to include TRANSPORT_STAFF)', async () => {
    const { controller, prisma } = makeController();

    const result = await controller.getUsers(
      { tenant: { tenantId: 'tenant-1' } } as any,
      { roles: 'OPS,WAREHOUSE', page: 1, pageSize: 25 } as any,
    );

    expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          role: { in: [Role.WAREHOUSE, Role.TRANSPORT_STAFF, Role.OPS] },
          NOT: { role: Role.DRIVER },
        }),
      }),
    );
    expect(result.data.map((row) => row.role)).toEqual([
      Role.TRANSPORT_STAFF,
      Role.WAREHOUSE,
    ]);
    expect(result.data[0]?.phone).toBe('+6512345678');
  });

  it('creates WAREHOUSE user membership', async () => {
    const { controller, prisma } = makeController();

    prisma.user.upsert.mockResolvedValue({
      id: 'u-new',
      email: 'floor@example.com',
      name: 'Floor User',
      phone: null,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    prisma.tenantMembership.upsert.mockResolvedValue({
      id: 'm-new',
      role: Role.WAREHOUSE,
      status: MembershipStatus.Invited,
    });

    const result = await controller.createUser(
      { tenant: { tenantId: 'tenant-1' } } as any,
      {
        email: 'floor@example.com',
        name: 'Floor User',
        role: Role.WAREHOUSE,
        sendInvite: true,
      },
    );

    expect(result.role).toBe(Role.WAREHOUSE);
    expect(prisma.tenantMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: Role.WAREHOUSE }),
      }),
    );
  });

  it('creates transport-staff user and stores TRANSPORT_STAFF', async () => {
    const { controller, prisma } = makeController();

    prisma.user.upsert.mockResolvedValue({
      id: 'u-ops',
      email: 'cs@example.com',
      name: 'CS User',
      phone: null,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    prisma.tenantMembership.upsert.mockResolvedValue({
      id: 'm-ops',
      role: Role.TRANSPORT_STAFF,
      status: MembershipStatus.Invited,
    });

    const result = await controller.createUser(
      { tenant: { tenantId: 'tenant-1' } } as any,
      {
        email: 'cs@example.com',
        name: 'CS User',
        role: Role.TRANSPORT_STAFF,
      },
    );

    expect(result.role).toBe(Role.TRANSPORT_STAFF);
    expect(prisma.tenantMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: Role.TRANSPORT_STAFF }),
        update: expect.objectContaining({ role: Role.TRANSPORT_STAFF }),
      }),
    );
  });

  it('rejects DRIVER role on create', async () => {
    const { controller } = makeController();

    await expect(
      controller.createUser(
        { tenant: { tenantId: 'tenant-1' } } as any,
        {
          email: 'driver@example.com',
          name: 'Driver',
          role: Role.DRIVER,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('redacts internal auth emails on list responses', async () => {
    const { controller } = makeController();
    const result = await controller.getUsers(
      { tenant: { tenantId: 'tenant-1' } } as any,
      { page: 1, pageSize: 25 } as any,
    );
    const warehouse = result.data.find((row) => row.role === Role.WAREHOUSE);
    expect(warehouse?.email).toBeNull();
    expect(warehouse?.username).toBe('floor1');
    expect(JSON.stringify(result)).not.toContain('auth.opsflow.app');
  });

  it('updates membership status for deactivate/reactivate without new membership', async () => {
    const { controller, prisma } = makeController();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: 'm-ops',
      role: Role.TRANSPORT_STAFF,
      status: MembershipStatus.Active,
      user: {
        id: 'u-ops',
        email: 'ops@example.com',
        username: null,
        name: 'Ops',
        phone: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    prisma.user.update.mockResolvedValue({
      id: 'u-ops',
      email: 'ops@example.com',
      username: null,
      name: 'Ops',
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.tenantMembership.update.mockResolvedValue({
      id: 'm-ops',
      role: Role.TRANSPORT_STAFF,
      status: MembershipStatus.Suspended,
    });

    const result = await controller.updateUser(
      { tenant: { tenantId: 'tenant-1' } } as any,
      'u-ops',
      { status: MembershipStatus.Suspended },
    );

    expect(prisma.tenantMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-ops' },
        data: expect.objectContaining({ status: MembershipStatus.Suspended }),
      }),
    );
    expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
    expect(result.status).toBe(MembershipStatus.Suspended);
    expect(result.email).toBe('ops@example.com');
  });

  it('rejects role changes that cross username vs email auth modes', async () => {
    const { controller, prisma } = makeController();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: 'm-wh',
      role: Role.WAREHOUSE,
      status: MembershipStatus.Active,
      user: {
        id: 'u-wh',
        email: 'tenant-a.floor1@auth.opsflow.app',
        username: 'floor1',
        name: 'Floor',
        phone: null,
      },
    });

    await expect(
      controller.updateUser(
        { tenant: { tenantId: 'tenant-1' } } as any,
        'u-wh',
        { role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/username\/password operational roles/);
  });

  it('rejects password reset for office email users', async () => {
    const { controller, prisma } = makeController();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: 'm-ops',
      role: Role.TRANSPORT_STAFF,
      status: MembershipStatus.Active,
      user: {
        id: 'u-ops',
        email: 'ops@example.com',
        username: null,
        authUserId: 'auth-ops',
      },
    });

    await expect(
      controller.resetUserPassword(
        { tenant: { tenantId: 'tenant-1' } } as any,
        'u-ops',
        { password: 'newpass123' },
      ),
    ).rejects.toThrow(/username\/password operational users/);
  });

  it('allows password reset for warehouse username users', async () => {
    const { controller, prisma, supabaseService } = makeController();
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: 'm-wh',
      role: Role.WAREHOUSE,
      status: MembershipStatus.Active,
      user: {
        id: 'u-wh',
        email: 'tenant-a.floor1@auth.opsflow.app',
        username: 'floor1',
        authUserId: 'auth-wh',
      },
    });

    const result = await controller.resetUserPassword(
      { tenant: { tenantId: 'tenant-1' } } as any,
      'u-wh',
      { password: 'newpass123' },
    );

    expect(result).toEqual({ ok: true });
    expect(
      supabaseService.getClient().auth.admin.updateUserById,
    ).toHaveBeenCalledWith('auth-wh', { password: 'newpass123' });
  });
});
