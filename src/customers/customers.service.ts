import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListCompaniesQueryDto, ListContactsQueryDto } from './dto/customers.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeCompanyName(name: string): string {
    return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private normalizeEmail(email: string): string {
    return String(email ?? '').trim().toLowerCase();
  }

  async searchCompanies(tenantId: string, query: ListCompaniesQueryDto) {
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const searchRaw = String(query.search ?? '').trim();

    const where: any = { tenantId };

    if (searchRaw) {
      const normalized = this.normalizeCompanyName(searchRaw);
      where.OR = [
        // use normalizedName for fast-ish matching when input is clean
        { normalizedName: { contains: normalized } },
        // allow raw contains in case user types partial with odd spacing
        { name: { contains: searchRaw, mode: 'insensitive' } },
      ];
    }

    const companies = await this.prisma.customer_companies.findMany({
      where,
      orderBy: { name: 'asc' },
      take: limit,
      select: {
        id: true,
        name: true,
      },
    });

    return companies;
  }

  async listContacts(tenantId: string, companyId: string, query: ListContactsQueryDto) {
    // tenant safety: ensure company belongs to tenant
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Customer company not found');

    const limit = Math.min(Number(query.limit ?? 20), 100);
    const searchRaw = String(query.search ?? '').trim();

    const where: any = { companyId };

    if (searchRaw) {
      const normalizedEmail = this.normalizeEmail(searchRaw);
      where.OR = [
        { normalizedEmail: { contains: normalizedEmail } },
        { email: { contains: searchRaw, mode: 'insensitive' } },
        { name: { contains: searchRaw, mode: 'insensitive' } },
      ];
    }

    const contacts = await this.prisma.customer_contacts.findMany({
      where,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return contacts;
  }
}
