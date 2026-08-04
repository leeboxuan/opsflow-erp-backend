import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  DriverWalletSummaryDto,
  DriverWalletTransactionDto,
} from './dto/wallet.dto';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async getDriverWalletSummaries(
    tenantId: string,
    month?: string,
  ): Promise<DriverWalletSummaryDto[]> {
    const dateFilter = this.buildMonthFilter(month);

    const grouped = await this.prisma.driverWalletTransaction.groupBy({
      by: ['driverId'],
      where: {
        driver: { tenantId },
        ...dateFilter,
      },
      _sum: { amountCents: true },
    });

    if (grouped.length === 0) return [];

    const driverIds = grouped.map((g) => g.driverId);
    const drivers = await this.prisma.drivers.findMany({
      where: { tenantId, id: { in: driverIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(drivers.map((d) => [d.id, d.name]));

    return grouped.map((g) => ({
      driverId: g.driverId,
      driverName: nameById.get(g.driverId) ?? '',
      totalCents: g._sum.amountCents ?? 0,
    }));
  }

  async getDriverWalletTransactions(
    tenantId: string,
    driverId: string,
    month?: string,
  ): Promise<DriverWalletTransactionDto[]> {
    const dateFilter = this.buildMonthFilter(month);

    const transactions = await this.prisma.driverWalletTransaction.findMany({
      where: {
        driverId,
        driver: { tenantId },
        ...dateFilter,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        amountCents: true,
        type: true,
        createdAt: true,
      },
    });

    return transactions.map((tx) => ({
      id: tx.id,
      amountCents: tx.amountCents,
      type: tx.type,
      referenceId: null,
      createdAt: tx.createdAt,
    }));
  }

  private buildMonthFilter(month?: string) {
    if (!month) return {};

    const [year, monthNum] = month.split('-').map(Number);

    const start = new Date(year, monthNum - 1, 1);
    const end = new Date(year, monthNum, 1);

    return {
      createdAt: {
        gte: start,
        lt: end,
      },
    };
  }
}
