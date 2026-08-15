import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { CanonicalTenantRole, MembershipStatus, Role, StopStatus, TripStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { SupabaseService } from "../../shared/auth/supabase.service";
import { UsersService } from "../../shared/users/users.service";
import { syncMembershipRoleRows } from "../../shared/auth/membership-roles";
import { isTransportDriverRole } from "../../shared/auth/canonical-tenant-role";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
} from "../../shared/common/pagination";
import { applyMappedFilter } from "../../shared/common/listing/listing.filters";
import { buildOrderBy } from "../../shared/common/listing/listing.sort";
import { AdminCreateDriverDto } from "./dto/admin-create-driver.dto";
import { AdminUpdateDriverDto } from "./dto/admin-update-driver.dto";
import { AdminDriverDto } from "./dto/admin-driver.dto";
import type {
  AdminDriverAssignedTripDto,
  AdminDriverEarningsDto,
  AdminDriverEarningsTransactionDto,
  AdminDriverSummaryDto,
  AdminDriverTripHistoryItemDto,
} from "./dto/admin-driver-detail.dto";
import type {
  DriverWalletDto,
  DriverWalletTransactionDto,
} from "./dto/driver-wallet.dto";
import { RealtimeEventsService } from "../../shared/realtime/realtime-events.service";
import * as rt from "../../shared/realtime/realtime-publish";
import { DriverTripEarningsService } from "./driver-trip-earnings.service";
import { resolveDriverTripEarningCents } from "./driver-trip-earnings.helpers";
import { CANONICAL_TRIP_PAYOUT_LINE_SELECT } from "../trips/trip-payout.helpers";
import {
  assertValidUsername,
  buildInternalAuthEmail,
  normalizeUsername,
  publicEmailOrNull,
} from "../../shared/auth/auth-internal-email";
import {
  assertUsernameGloballyAvailable,
  rethrowUsernameUniqueConflict,
} from "../../shared/auth/username-uniqueness";

function firstNonEmptyText(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function publicDriverEmail(email: string | null | undefined): string | null {
  return publicEmailOrNull(email);
}

function driverDisplayFallback(user: {
  displayName?: string | null;
  name?: string | null;
  username?: string | null;
  email?: string | null;
}): string | null {
  return (
    firstNonEmptyText(
      user.displayName,
      user.name,
      user.username,
      publicDriverEmail(user.email),
    )
  );
}

@Injectable()
export class AdminDriversService {
  private readonly logger = new Logger(AdminDriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
    private readonly tripEarnings: DriverTripEarningsService,
    @Optional() private readonly realtime?: RealtimeEventsService,
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
      OR: [
        { role: Role.DRIVER },
        {
          membershipRoles: {
            some: { role: CanonicalTenantRole.TRANSPORT_DRIVER },
          },
        },
      ],
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
          { username: { contains: q, mode: "insensitive" } },
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
          status: true,
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
          status: true,
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
      { id: string; plateNo: string; type: any; status: any }
    >();
    for (const v of vehicles) {
      if (v.driverId) vehicleByDriverId.set(v.driverId, v);
    }
    const fleetVehicleByDriverId = new Map<
      string,
      { id: string; plateNo: string; type: any; status: any }
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
        driverDisplayFallback(m.user as any);
      const avatarUrl = await this.usersService.getUserAvatarSignedUrl(
        (m.user as any).avatarKey ?? null,
      );
      const publicEmail = publicDriverEmail(m.user.email);

      return {
        userId: m.user.id,
        id: m.user.id,
        email: publicEmail,
        username: (m.user as any).username ?? null,
        name: displayName,
        displayName,
        userName: m.user.name ?? null,
        userEmail: publicEmail,
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
        assignedVehicleStatus: v?.status ?? null,
        assignedFleetVehicleId: fv?.id ?? null,
        assignedFleetVehiclePlateNo: fv?.plateNo ?? null,
        assignedFleetVehicleType: fv?.type ?? null,
        assignedFleetVehicleStatus: fv?.status ?? null,
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
    const password = dto.password;
    if (!password || password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const usernameRaw = dto.username?.trim() ?? "";
    if (!usernameRaw) {
      throw new BadRequestException("Username is required");
    }

    const normalizedUsername = normalizeUsername(usernameRaw);
    try {
      assertValidUsername(normalizedUsername);
    } catch (e: any) {
      throw new BadRequestException(e?.message || "Invalid username");
    }

    await assertUsernameGloballyAvailable(this.prisma, normalizedUsername);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    if (!tenant?.slug) {
      throw new BadRequestException(
        "Tenant slug is required for username users",
      );
    }
    const authEmail = buildInternalAuthEmail(tenant.slug, normalizedUsername);

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: dto.name ?? undefined,
        username: normalizedUsername,
        tenantId,
        role: "TRANSPORT_DRIVER",
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    const authUserId = data.user?.id;
    if (!authUserId) {
      throw new BadRequestException("Failed to create auth user");
    }

    let result: { user: any; membership: any };
    try {
      result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: authEmail },
        update: {
          authUserId,
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(normalizedUsername && { username: normalizedUsername }),
        },
        create: {
          authUserId,
          email: authEmail,
          username: normalizedUsername,
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

      await syncMembershipRoleRows(
        tx,
        membership.id,
        [CanonicalTenantRole.TRANSPORT_DRIVER],
        null,
      );

      const name =
        (dto.name ?? user.name ?? "").trim() ||
        user.username ||
        publicDriverEmail(user.email) ||
        "Driver";
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
    } catch (e) {
      await this.compensateDeleteAuthUser(authUserId);
      rethrowUsernameUniqueConflict(e);
      throw e;
    }

    rt.publishDriverEvent(
      this.realtime,
      "driver.created",
      tenantId,
      result.user.id,
    );

    const publicEmail = publicDriverEmail(result.user.email);
    return {
      userId: result.user.id,
      id: result.user.id,
      email: publicEmail,
      username: result.user.username ?? null,
      name: result.user.name,
      displayName:
        (result.user as any).displayName ??
        result.user.name ??
        result.user.username ??
        publicEmail,
      userName: result.user.name ?? null,
      userEmail: publicEmail,
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
      include: { user: true, membershipRoles: { select: { role: true } } },
    });

    if (
      !membership ||
      (!isTransportDriverRole(membership.role) &&
        !membership.membershipRoles.some((row) =>
          isTransportDriverRole(row.role),
        ))
    ) {
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

    const name =
      (dto.name ?? user.name ?? "").trim() ||
      user.username ||
      publicDriverEmail(user.email) ||
      "Driver";
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

    rt.publishDriverEvent(this.realtime, "driver.updated", tenantId, driverUserId);

    return {
      userId: user.id,
      id: user.id,
      email: publicDriverEmail(user.email),
      username: user.username ?? null,
      name: profile?.name ?? driverDisplayFallback(user as any),
      displayName: driverDisplayFallback(user as any),
      userName: user.name ?? null,
      userEmail: publicDriverEmail(user.email),
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

    rt.publishDriverEvent(this.realtime, "driver.updated", tenantId, driverUserId);

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

    rt.publishDriverEvent(this.realtime, "driver.updated", tenantId, driverUserId);

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
      select: { id: true },
    });
    if (!driver) return { month, transactions: [], totalCents: 0 };

    const transactions = await this.prisma.driverWalletTransaction.findMany({
      where: {
        tenantId,
        driverId: driver.id,
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tripId: true,
        amountCents: true,
        currency: true,
        type: true,
        description: true,
        createdAt: true,
      },
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

  private async requireDriverMembership(tenantId: string, driverUserId: string) {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: driverUserId } },
      include: { user: true, membershipRoles: { select: { role: true } } },
    });
    if (
      !membership ||
      (!isTransportDriverRole(membership.role) &&
        !membership.membershipRoles.some((row) =>
          isTransportDriverRole(row.role),
        ))
    ) {
      throw new NotFoundException("Driver not found");
    }
    return membership;
  }

  private async buildAdminDriverDto(
    tenantId: string,
    membership: {
      id: string;
      status: MembershipStatus;
      user: {
        id: string;
        email: string;
        username?: string | null;
        name: string | null;
        displayName?: string | null;
        phone?: string | null;
        avatarKey?: string | null;
        avatarUpdatedAt?: Date | null;
        createdAt: Date;
        updatedAt: Date;
      };
    },
  ): Promise<AdminDriverDto> {
    const userId = membership.user.id;
    const [profile, vehicle, fleetVehicle] = await Promise.all([
      this.prisma.drivers.findFirst({
        where: { tenantId, userId },
        select: {
          name: true,
          assignedVehicleId: true,
          assignedFleetVehicleId: true,
        },
      }),
      this.prisma.vehicle.findFirst({
        where: { tenantId, driverId: userId },
        select: { id: true, plateNo: true, type: true, status: true },
      }),
      this.prisma.fleetVehicle.findFirst({
        where: { tenantId, driverId: userId },
        select: { id: true, plateNo: true, type: true, status: true },
      }),
    ]);

    const displayName =
      profile?.name ?? driverDisplayFallback(membership.user as any);
    const avatarUrl = await this.usersService.getUserAvatarSignedUrl(
      membership.user.avatarKey ?? null,
    );
    const publicEmail = publicDriverEmail(membership.user.email);

    return {
      userId,
      id: userId,
      email: publicEmail,
      username: membership.user.username ?? null,
      name: displayName,
      displayName,
      userName: membership.user.name ?? null,
      userEmail: publicEmail,
      phone: membership.user.phone ?? null,
      status: membership.status,
      isSuspended: membership.status === MembershipStatus.Suspended,
      membershipId: membership.id,
      createdAt: membership.user.createdAt,
      updatedAt: membership.user.updatedAt,
      avatarUrl,
      avatarUpdatedAt: membership.user.avatarUpdatedAt ?? null,
      defaultVehicleId: profile?.assignedVehicleId ?? null,
      defaultFleetVehicleId: profile?.assignedFleetVehicleId ?? null,
      assignedVehicleId: vehicle?.id ?? null,
      assignedVehiclePlateNo: vehicle?.plateNo ?? null,
      assignedVehicleType: vehicle?.type ?? null,
      assignedVehicleStatus: vehicle?.status ?? null,
      assignedFleetVehicleId: fleetVehicle?.id ?? null,
      assignedFleetVehiclePlateNo: fleetVehicle?.plateNo ?? null,
      assignedFleetVehicleType: fleetVehicle?.type ?? null,
      assignedFleetVehicleStatus: fleetVehicle?.status ?? null,
    };
  }

  private tripRouteSummaries(trip: {
    originLabel?: string | null;
    originAddressLine1?: string | null;
    originAddressLine2?: string | null;
    originPostalCode?: string | null;
    destinationLabel?: string | null;
    destinationAddressLine1?: string | null;
    destinationAddressLine2?: string | null;
    destinationPostalCode?: string | null;
    job?: {
      pickupAddress1?: string | null;
      pickupAddress2?: string | null;
      pickupPostal?: string | null;
      deliveryAddress1?: string | null;
      deliveryAddress2?: string | null;
      deliveryPostal?: string | null;
    } | null;
  }): { originSummary: string | null; destinationSummary: string | null } {
    return {
      originSummary:
        firstNonEmptyText(
          trip.originLabel,
          trip.originAddressLine1,
          trip.originAddressLine2,
          trip.originPostalCode,
        ) ??
        firstNonEmptyText(
          trip.job?.pickupAddress1,
          trip.job?.pickupAddress2,
          trip.job?.pickupPostal,
        ),
      destinationSummary:
        firstNonEmptyText(
          trip.destinationLabel,
          trip.destinationAddressLine1,
          trip.destinationAddressLine2,
          trip.destinationPostalCode,
        ) ??
        firstNonEmptyText(
          trip.job?.deliveryAddress1,
          trip.job?.deliveryAddress2,
          trip.job?.deliveryPostal,
        ),
    };
  }

  private async resolveCurrentOrNextTrip(
    tenantId: string,
    driverUserId: string,
  ): Promise<AdminDriverAssignedTripDto | null> {
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { in: [TripStatus.ONGOING, TripStatus.PUBLISHED] },
      },
      orderBy: [
        { plannedStartAt: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        jobId: true,
        title: true,
        displayTitle: true,
        status: true,
        plannedStartAt: true,
        startedAt: true,
        createdAt: true,
        originLabel: true,
        originAddressLine1: true,
        originAddressLine2: true,
        originPostalCode: true,
        destinationLabel: true,
        destinationAddressLine1: true,
        destinationAddressLine2: true,
        destinationPostalCode: true,
        job: {
          select: {
            internalRef: true,
            pickupAddress1: true,
            pickupAddress2: true,
            pickupPostal: true,
            deliveryAddress1: true,
            deliveryAddress2: true,
            deliveryPostal: true,
          },
        },
      },
    });

    const current = trips.find((t) => t.status === TripStatus.ONGOING) ?? null;
    const next =
      current ??
      trips.find((t) => t.status === TripStatus.PUBLISHED) ??
      null;
    if (!next) return null;

    const route = this.tripRouteSummaries(next);
    return {
      tripId: next.id,
      jobId: next.jobId ?? null,
      jobInternalRef: next.job?.internalRef ?? null,
      title: next.title ?? next.displayTitle ?? null,
      status: next.status,
      plannedStartAt: next.plannedStartAt,
      startedAt: next.startedAt,
      originSummary: route.originSummary,
      destinationSummary: route.destinationSummary,
      kind: current ? "current" : "next",
    };
  }

  async getDriverSummary(
    tenantId: string,
    driverUserId: string,
    month?: string | null,
  ): Promise<AdminDriverSummaryDto> {
    const membership = await this.requireDriverMembership(tenantId, driverUserId);
    const [driver, currentOrNextTrip, earnings] = await Promise.all([
      this.buildAdminDriverDto(tenantId, membership as any),
      this.resolveCurrentOrNextTrip(tenantId, driverUserId),
      this.tripEarnings.getEarningsTotals(tenantId, driverUserId, month),
    ]);

    return {
      driver,
      currentOrNextTrip,
      month: earnings.month,
      monthEarningsCents: earnings.monthCents,
      lifetimeEarningsCents: earnings.lifetimeCents,
      currency: earnings.currency,
      completedTripCountLifetime: earnings.lifetimeCompletedTripCount,
      completedTripCountMonth: earnings.monthCompletedTripCount,
      timeZone: earnings.timeZone,
    };
  }

  async listDriverTrips(
    tenantId: string,
    driverUserId: string,
    query?: { page?: unknown; pageSize?: unknown },
  ): Promise<{
    data: AdminDriverTripHistoryItemDto[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    await this.requireDriverMembership(tenantId, driverUserId);
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query ?? {});

    const where = {
      tenantId,
      assignedDriverUserId: driverUserId,
      status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
    };

    const [total, trips] = await this.prisma.$transaction([
      this.prisma.trip.count({ where }),
      this.prisma.trip.findMany({
        where,
        orderBy: [
          { closedAt: "desc" },
          { updatedAt: "desc" },
          { id: "desc" },
        ],
        skip,
        take,
        select: {
          id: true,
          jobId: true,
          title: true,
          displayTitle: true,
          status: true,
          closedAt: true,
          startedAt: true,
          plannedStartAt: true,
          updatedAt: true,
          driverEarningCents: true,
          earningLabelSnapshot: true,
          originLabel: true,
          originAddressLine1: true,
          originAddressLine2: true,
          originPostalCode: true,
          destinationLabel: true,
          destinationAddressLine1: true,
          destinationAddressLine2: true,
          destinationPostalCode: true,
          payoutLines: { select: CANONICAL_TRIP_PAYOUT_LINE_SELECT },
          job: {
            select: {
              internalRef: true,
              pickupAddress1: true,
              pickupAddress2: true,
              pickupPostal: true,
              deliveryAddress1: true,
              deliveryAddress2: true,
              deliveryPostal: true,
            },
          },
        },
      }),
    ]);

    const tripIds = trips.map((t) => t.id);
    const stopGroups =
      tripIds.length === 0
        ? []
        : await this.prisma.stop.groupBy({
            by: ["tripId", "status"],
            where: { tenantId, tripId: { in: tripIds } },
            _count: { _all: true },
          });

    const stopCountByTrip = new Map<string, number>();
    const completedStopCountByTrip = new Map<string, number>();
    for (const row of stopGroups) {
      if (!row.tripId) continue;
      stopCountByTrip.set(
        row.tripId,
        (stopCountByTrip.get(row.tripId) ?? 0) + row._count._all,
      );
      if (row.status === StopStatus.Completed) {
        completedStopCountByTrip.set(
          row.tripId,
          (completedStopCountByTrip.get(row.tripId) ?? 0) + row._count._all,
        );
      }
    }

    const data: AdminDriverTripHistoryItemDto[] = trips.map((trip) => {
      const route = this.tripRouteSummaries(trip);
      return {
        tripId: trip.id,
        jobId: trip.jobId ?? null,
        jobInternalRef: trip.job?.internalRef ?? null,
        title: trip.title ?? trip.displayTitle ?? null,
        status: trip.status,
        tripDate: trip.closedAt ?? trip.updatedAt ?? trip.plannedStartAt ?? null,
        closedAt: trip.closedAt,
        startedAt: trip.startedAt,
        plannedStartAt: trip.plannedStartAt,
        originSummary: route.originSummary,
        destinationSummary: route.destinationSummary,
        stopCount: stopCountByTrip.get(trip.id) ?? 0,
        completedStopCount: completedStopCountByTrip.get(trip.id) ?? 0,
        driverEarningCents: resolveDriverTripEarningCents(trip),
        earningLabelSnapshot: trip.earningLabelSnapshot ?? null,
      };
    });

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getDriverEarnings(
    tenantId: string,
    driverUserId: string,
    month?: string | null,
  ): Promise<AdminDriverEarningsDto> {
    await this.requireDriverMembership(tenantId, driverUserId);
    const earnings = await this.tripEarnings.getEarningsTotals(
      tenantId,
      driverUserId,
      month,
    );
    return {
      month: earnings.month,
      monthCents: earnings.monthCents,
      lifetimeCents: earnings.lifetimeCents,
      currency: earnings.currency,
      monthCompletedTripCount: earnings.monthCompletedTripCount,
      lifetimeCompletedTripCount: earnings.lifetimeCompletedTripCount,
      timeZone: earnings.timeZone,
    };
  }

  async listDriverEarningsTransactions(
    tenantId: string,
    driverUserId: string,
    query?: { month?: string; page?: unknown; pageSize?: unknown },
  ): Promise<{
    data: AdminDriverEarningsTransactionDto[];
    meta: { page: number; pageSize: number; total: number };
    month: string;
    currency: string;
  }> {
    await this.requireDriverMembership(tenantId, driverUserId);
    return this.tripEarnings.listEarningsTransactions(
      tenantId,
      driverUserId,
      query,
    );
  }

  /**
   * Compensating delete for an auth identity created in this request only.
   * Driver creation must not leave an unusable auth user if Prisma provisioning fails.
   */
  private async compensateDeleteAuthUser(authUserId: string): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.auth.admin.deleteUser(authUserId);
      if (error) {
        this.logger.error(
          `Compensation deleteUser failed for newly created driver auth identity (id redacted length=${authUserId.length}): ${error.message}`,
        );
        throw new BadRequestException(
          "Driver provisioning failed and auth compensation also failed; contact support",
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(
        "Compensation deleteUser threw for newly created driver auth identity",
      );
      throw new BadRequestException(
        "Driver provisioning failed and auth compensation also failed; contact support",
      );
    }
  }
}
