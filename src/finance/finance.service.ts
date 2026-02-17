import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

    const transactions = await this.prisma.driverWalletTransaction.findMany({
      where: {
        driver: { tenantId },
        ...dateFilter,
      },
      include: {
        driver: true,
      },
    });

    const map = new Map<string, DriverWalletSummaryDto>();

    for (const tx of transactions) {
      if (!map.has(tx.driverId)) {
        map.set(tx.driverId, {
          driverId: tx.driverId,
          driverName: tx.driver.name,
          totalCents: 0,
        });
      }

      const entry = map.get(tx.driverId)!;
      entry.totalCents += tx.amountCents;
    }

    return Array.from(map.values());
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
    });

    return transactions.map((tx) => ({
      id: tx.id,
      amountCents: tx.amountCents,
      type: tx.type,
      referenceId: tx.referenceId,
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
