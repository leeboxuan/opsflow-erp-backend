import { BadRequestException } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import { AdminController } from './admin.controller';

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
              email: 'warehouse@example.com',
              name: 'Warehouse User',
              phone: null,
              createdAt: new Date('2026-07-01T00:00:00.000Z'),
              updatedAt: new Date('2026-07-01T00:00:00.000Z'),
            },
          },
        ]),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
      customer_companies: { upsert: jest.fn() },
      customer_contacts: { upsert: jest.fn() },
    };

    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        auth: {
          admin: {
            inviteUserByEmail: jest.fn().mockResolvedValue({ error: null }),
          },
        },
      }),
    };

    const controller = new AdminController(
      prisma,
      {} as any,
      supabaseService,
    );

    return { controller, prisma, supabaseService };
  }

  it('lists users filtered by OPS and WAREHOUSE roles', async () => {
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

  it('creates transport-staff user but stores OPS during compatibility window', async () => {
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
      role: Role.OPS,
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

    expect(result.role).toBe(Role.OPS);
    expect(prisma.tenantMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: Role.OPS }),
        update: expect.objectContaining({ role: Role.OPS }),
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
});
