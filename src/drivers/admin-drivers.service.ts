import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MembershipStatus, Role, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import { UsersService } from "../users/users.service";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
} from "../common/pagination";
import { applyMappedFilter } from "../common/listing/listing.filters";
import { buildOrderBy } from "../common/listing/listing.sort";
import { AdminCreateDriverDto } from "./dto/admin-create-driver.dto";
import { AdminUpdateDriverDto } from "./dto/admin-update-driver.dto";
import { AdminDriverDto } from "./dto/admin-driver.dto";
import type {
  DriverWalletDto,
  DriverWalletTransactionDto,
} from "../driver/dto/driver-trip.dto";

@Injectable()
export class AdminDriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
  ) {}

  async listDrivers(
    tenantId: string,
    query?: {
      q?: string;
      filter?: string;
      sortBy?: string;
      sortDir?: string;
      page?: unknown;
      pageSize?: unknown;
    },
  ): Promise<{
    data: AdminDriverDto[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(
      query ?? {},
    );

    const where: any = {
      tenantId,
      role: Role.DRIVER,
      status: { in: [MembershipStatus.Active, MembershipStatus.Suspended] },
    };
    applyMappedFilter(where, query?.filter, {
      all: {
        status: { in: [MembershipStatus.Active, MembershipStatus.Suspended] },
      },
      active: { status: MembershipStatus.Active },
      suspended: { status: MembershipStatus.Suspended },
    });
    const q = query?.q?.trim();
    if (q) {
      where.user = {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      };
    }

    let orderBy: any = { user: { name: "asc" } };
    if (query?.sortBy === "name" || query?.sortBy === "email") {
      orderBy = {
        user: { [query.sortBy]: query.sortDir === "desc" ? "desc" : "asc" },
      };
    } else {
      orderBy = buildOrderBy(
        query?.sortBy,
        query?.sortDir,
        ["createdAt", "updatedAt"],
        { createdAt: "desc" },
      );
    }

    const [total, memberships] = await this.prisma.$transaction([
      this.prisma.tenantMembership.count({ where }),
      this.prisma.tenantMembership.findMany({
        where,
        include: { user: true },
        orderBy,
        skip,
        take,
      }),
    ]);

    const userIds = memberships.map((m) => m.userId);

    const [driverProfiles, vehicles, fleetVehicles] = await this.prisma.$transaction([
      this.prisma.drivers.findMany({
        where: { tenantId, userId: { in: userIds } },
        select: {
          userId: true,
          name: true,
          assignedVehicleId: true,
          assignedFleetVehicleId: true,
        },
      }),
      this.prisma.vehicle.findMany({
        where: {
          tenantId,
          driverId: { in: userIds },
        },
        select: {
          id: true,
          plateNo: true,
          type: true,
          driverId: true,
        },
      }),
      this.prisma.fleetVehicle.findMany({
        where: {
          tenantId,
          driverId: { in: userIds },
        },
        select: {
          id: true,
          plateNo: true,
          type: true,
          driverId: true,
        },
      }),
    ]);

    const profileByUserId = new Map<
      string | null,
      {
        userId: string | null;
        name: string | null;
        assignedVehicleId: string | null;
        assignedFleetVehicleId: string | null;
      }
    >(driverProfiles.map((p) => [p.userId, p]));

    const vehicleByDriverId = new Map<
      string,
      { id: string; plateNo: string; type: any }
    >();
    for (const v of vehicles) {
      if (v.driverId) vehicleByDriverId.set(v.driverId, v);
    }
    const fleetVehicleByDriverId = new Map<
      string,
      { id: string; plateNo: string; type: any }
    >();
    for (const v of fleetVehicles) {
      if (v.driverId) fleetVehicleByDriverId.set(v.driverId, v);
    }

    const data = await Promise.all(memberships.map(async (m) => {
      const v = vehicleByDriverId.get(m.userId) ?? null;
      const fv = fleetVehicleByDriverId.get(m.userId) ?? null;
      const profile = profileByUserId.get(m.userId);
      const displayName =
        profile?.name ??
        (m.user as any).displayName ??
        m.user.name ??
        m.user.email ??
        null;
      const avatarUrl = await this.usersService.getUserAvatarSignedUrl(
        (m.user as any).avatarKey ?? null,
      );

      return {
        userId: m.user.id,
        id: m.user.id,
        email: m.user.email,
        name: displayName,
        displayName,
        userName: m.user.name ?? null,
        userEmail: m.user.email ?? null,
        phone: (m.user as any).phone ?? null,
        status: m.status,
        isSuspended: m.status === MembershipStatus.Suspended,
        membershipId: m.id,
        createdAt: m.user.createdAt,
        updatedAt: m.user.updatedAt,
        avatarUrl,
        avatarUpdatedAt: (m.user as any).avatarUpdatedAt ?? null,

        defaultVehicleId: profile?.assignedVehicleId ?? null,
        defaultFleetVehicleId: profile?.assignedFleetVehicleId ?? null,
        assignedVehicleId: v?.id ?? null,
        assignedVehiclePlateNo: v?.plateNo ?? null,
        assignedVehicleType: v?.type ?? null,
        assignedFleetVehicleId: fv?.id ?? null,
        assignedFleetVehiclePlateNo: fv?.plateNo ?? null,
        assignedFleetVehicleType: fv?.type ?? null,
      };
    }));

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async createDriver(
    tenantId: string,
    dto: AdminCreateDriverDto,
  ): Promise<AdminDriverDto> {
    const email = dto.email.trim().toLowerCase();
    const password = dto.password;

    if (!password || password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: dto.name ?? undefined,
        tenantId,
        role: "DRIVER",
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    const authUserId = data.user?.id;
    if (!authUserId) {
      throw new BadRequestException("Failed to create auth user");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email },
        update: {
          authUserId,
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
        },
        create: {
          authUserId,
          email,
          name: dto.name ?? null,
          phone: dto.phone ?? null,
          role: UserRole.USER,
        },
      });

      const membership = await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        update: { role: Role.DRIVER, status: MembershipStatus.Active },
        create: {
          tenantId,
          userId: user.id,
          role: Role.DRIVER,
          status: MembershipStatus.Active,
        },
      });

      // ✅ Wallet depends on prisma.drivers row
      const name = (dto.name ?? user.name ?? "").trim() || user.email;
      const phone =
        ((dto.phone ?? (user as any).phone ?? "") as string).trim() || "-";

      await tx.drivers.upsert({
        where: { tenantId_email: { tenantId, email: user.email } },
        update: {
          name,
          phone,
          userId: user.id,
          updatedAt: new Date(),
        },
        create: {
          id: `drv_${tenantId}_${user.email.replace(/[@.]/g, "_")}`,
          tenantId,
          email: user.email,
          name,
          phone,
          userId: user.id,
          updatedAt: new Date(),
        },
      });

      return { user, membership };
    });

    return {
      userId: result.user.id,
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      displayName: (result.user as any).displayName ?? result.user.name ?? result.user.email,
      userName: result.user.name ?? null,
      userEmail: result.user.email ?? null,
      phone: (result.user as any).phone ?? null,
      status: result.membership.status,
      isSuspended: result.membership.status === MembershipStatus.Suspended,
      membershipId: result.membership.id,
      createdAt: result.user.createdAt,
      updatedAt: result.user.updatedAt,
      avatarUrl: await this.usersService.getUserAvatarSignedUrl(
        (result.user as any).avatarKey ?? null,
      ),
      avatarUpdatedAt: (result.user as any).avatarUpdatedAt ?? null,
    };
  }

  async updateDriver(
    tenantId: string,
    driverUserId: string,
    dto: AdminUpdateDriverDto,
    actorUserId: string | null,
  ): Promise<AdminDriverDto> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: driverUserId } },
      include: { user: true },
    });

    if (!membership || membership.role !== Role.DRIVER) {
      throw new NotFoundException("Driver not found");
    }

    const user =
      dto.name !== undefined
        ? await this.usersService.updateUserDisplayNameAndPropagate({
            tenantId,
            userId: driverUserId,
            newName: dto.name,
            actorUserId,
          })
        : await this.prisma.user.update({
            where: { id: driverUserId },
            data: {
              ...(dto.phone !== undefined && { phone: dto.phone }),
            },
          });

    const name = (dto.name ?? user.name ?? "").trim() || user.email;
    const phone =
      ((dto.phone ?? (user as any).phone ?? "") as string).trim() || "-";

    const hasVehicle =
      dto.assignedVehicleId !== undefined && !!dto.assignedVehicleId;
    const hasFleetVehicle =
      dto.assignedFleetVehicleId !== undefined && !!dto.assignedFleetVehicleId;

    if (hasVehicle && hasFleetVehicle) {
      throw new BadRequestException(
        "Driver default assignment must be either vehicle or fleet vehicle, not both",
      );
    }

    if (dto.assignedVehicleId !== undefined) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.assignedVehicleId, tenantId },
      });
      if (dto.assignedVehicleId && !vehicle) {
        throw new BadRequestException("Vehicle not found");
      }
    }
    if (dto.assignedFleetVehicleId !== undefined) {
      const fleetVehicle = await this.prisma.fleetVehicle.findFirst({
        where: { id: dto.assignedFleetVehicleId, tenantId },
      });
      if (dto.assignedFleetVehicleId && !fleetVehicle) {
        throw new BadRequestException("Fleet vehicle not found");
      }
    }

    const vehicleAssignmentPatch =
      dto.assignedVehicleId !== undefined
        ? {
            assignedVehicleId: dto.assignedVehicleId || null,
            assignedFleetVehicleId: null,
          }
        : dto.assignedFleetVehicleId !== undefined
          ? {
              assignedVehicleId: null,
              assignedFleetVehicleId: dto.assignedFleetVehicleId || null,
            }
          : {};

    await this.prisma.drivers.upsert({
      where: { tenantId_email: { tenantId, email: user.email } },
      update: {
        name,
        phone,
        userId: user.id,
        ...vehicleAssignmentPatch,
        updatedAt: new Date(),
      },
      create: {
        id: `drv_${tenantId}_${user.email.replace(/[@.]/g, "_")}`,
        tenantId,
        email: user.email,
        name,
        phone,
        userId: user.id,
        ...vehicleAssignmentPatch,
        updatedAt: new Date(),
      },
    });

    const profile = await this.prisma.drivers.findFirst({
      where: { tenantId, userId: user.id },
      select: {
        assignedVehicleId: true,
        assignedFleetVehicleId: true,
      },
    });

    return {
      userId: user.id,
      id: user.id,
      email: user.email,
      name: profile?.name ?? (user as any).displayName ?? user.name ?? user.email,
      displayName: (user as any).displayName ?? user.name ?? user.email,
      userName: user.name ?? null,
      userEmail: user.email ?? null,
      phone: (user as any).phone ?? null,
      status: membership.status,
      isSuspended: membership.status === MembershipStatus.Suspended,
      membershipId: membership.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      avatarUrl: await this.usersService.getUserAvatarSignedUrl(
        (user as any).avatarKey ?? null,
      ),
      avatarUpdatedAt: (user as any).avatarUpdatedAt ?? null,
      defaultVehicleId: profile?.assignedVehicleId ?? null,
      defaultFleetVehicleId: profile?.assignedFleetVehicleId ?? null,
    };
  }

  async suspendDriver(tenantId: string, driverUserId: string) {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: driverUserId } },
    });
    if (!membership) throw new NotFoundException("Driver not found");

    await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.Suspended },
    });

    return { id: driverUserId, status: MembershipStatus.Suspended };
  }

  async unsuspendDriver(tenantId: string, driverUserId: string) {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: driverUserId } },
    });
    if (!membership) throw new NotFoundException("Driver not found");

    await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.Active },
    });

    return { id: driverUserId, status: MembershipStatus.Active };
  }

  // ✅ Admin wallet endpoint for Drivers panel
  async getDriverWallet(
    tenantId: string,
    driverUserId: string,
    month: string,
  ): Promise<DriverWalletDto> {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) {
      throw new BadRequestException("Invalid month format; use YYYY-MM");
    }
    const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));

    const driver = await this.prisma.drivers.findFirst({
      where: { tenantId, userId: driverUserId },
    });
    if (!driver) return { month, transactions: [], totalCents: 0 };

    const transactions = await this.prisma.driverWalletTransaction.findMany({
      where: {
        tenantId,
        driverId: driver.id,
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalCents = transactions.reduce((sum, t) => sum + t.amountCents, 0);

    return {
      month,
      totalCents,
      transactions: transactions.map(
        (t): DriverWalletTransactionDto => ({
          id: t.id,
          tripId: t.tripId,
          amountCents: t.amountCents,
          currency: t.currency,
          type: t.type,
          description: t.description,
          createdAt: t.createdAt,
        }),
      ),
    };
  }
}
