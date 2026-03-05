import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MembershipStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AdminCreateDriverDto } from "./dto/admin-create-driver.dto";
import { AdminUpdateDriverDto } from "./dto/admin-update-driver.dto";
import { AdminDriverDto } from "./dto/admin-driver.dto";
import type { DriverWalletDto, DriverWalletTransactionDto } from "../driver/dto/driver-trip.dto";

@Injectable()
export class AdminDriversService {
  constructor(private readonly prisma: PrismaService) {}

  async listDrivers(tenantId: string): Promise<AdminDriverDto[]> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        role: Role.DRIVER,
        status: { in: [MembershipStatus.Active, MembershipStatus.Suspended] },
      },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    });

    return memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      phone: (m.user as any).phone ?? null,
      status: m.status,
      isSuspended: m.status === MembershipStatus.Suspended,
      membershipId: m.id,
      createdAt: m.user.createdAt,
      updatedAt: m.user.updatedAt,
    }));
  }

  async createDriver(tenantId: string, dto: AdminCreateDriverDto): Promise<AdminDriverDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: dto.email },
        update: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
        },
        create: {
          email: dto.email,
          name: dto.name ?? null,
          phone: dto.phone ?? null,
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
      const phone = ((dto.phone ?? (user as any).phone ?? "") as string).trim() || "-";

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
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      phone: (result.user as any).phone ?? null,
      status: result.membership.status,
      isSuspended: result.membership.status === MembershipStatus.Suspended,
      membershipId: result.membership.id,
      createdAt: result.user.createdAt,
      updatedAt: result.user.updatedAt,
    };
  }

  async updateDriver(tenantId: string, driverUserId: string, dto: AdminUpdateDriverDto): Promise<AdminDriverDto> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: driverUserId } },
      include: { user: true },
    });

    if (!membership || membership.role !== Role.DRIVER) {
      throw new NotFoundException("Driver not found");
    }

    const user = await this.prisma.user.update({
      where: { id: driverUserId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
    });

    const name = (dto.name ?? user.name ?? "").trim() || user.email;
    const phone = ((dto.phone ?? (user as any).phone ?? "") as string).trim() || "-";

    await this.prisma.drivers.upsert({
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

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: (user as any).phone ?? null,
      status: membership.status,
      isSuspended: membership.status === MembershipStatus.Suspended,
      membershipId: membership.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
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
  async getDriverWallet(tenantId: string, driverUserId: string, month: string): Promise<DriverWalletDto> {
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