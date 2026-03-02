import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { ListCompaniesQueryDto, ListContactsQueryDto } from './dto/customers.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

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
        { normalizedName: { contains: normalized } },
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
        _count: {
          select: {
            contacts: true,
            users: true,
          },
        },
      },
    });

    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      contactCount: c._count.contacts,
      userCount: c._count.users,
    }));
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

  async createCompany(tenantId: string, name: string) {
    const companyName = String(name ?? '').trim();
    if (!companyName) throw new BadRequestException('name is required');

    const normalizedName = this.normalizeCompanyName(companyName);

    // Upsert keeps it idempotent (avoids annoying unique constraint errors)
    const company = await this.prisma.customer_companies.upsert({
      where: {
        tenantId_normalizedName: {
          tenantId,
          normalizedName,
        },
      },
      update: {
        name: companyName,
      },
      create: {
        tenantId,
        name: companyName,
        normalizedName,
      },
      select: {
        id: true,
        name: true,
        _count: { select: { contacts: true, users: true } },
      },
    });

    return {
      id: company.id,
      name: company.name,
      contactCount: company._count.contacts,
      userCount: company._count.users,
    };
  }

  async createContact(
    tenantId: string,
    companyId: string,
    input: { name: string; email: string },
  ) {
    // tenant safety: ensure company belongs to tenant
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Customer company not found');

    const contactName = String(input.name ?? '').trim();
    const email = this.normalizeEmail(input.email);
    if (!contactName) throw new BadRequestException('name is required');
    if (!email) throw new BadRequestException('email is required');

    // Upsert keeps it idempotent for "add contact" UX
    const contact = await this.prisma.customer_contacts.upsert({
      where: {
        companyId_normalizedEmail: {
          companyId,
          normalizedEmail: email,
        },
      },
      update: {
        name: contactName,
        email,
      },
      create: {
        companyId,
        name: contactName,
        email,
        normalizedEmail: email,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return contact;
  }

  async listCompanyUsers(tenantId: string, companyId: string) {
    // tenant safety: ensure company belongs to tenant
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Customer company not found');

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        role: Role.CUSTOMER,
        user: {
          customerCompanyId: companyId,
        },
      },
      include: { user: true },
      orderBy: { user: { email: 'asc' } },
    });

    return memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      status: m.status,
    }));
  }

  async createCompanyUser(
    tenantId: string,
    companyId: string,
    input: { email: string; name?: string; sendInvite?: boolean },
  ) {
    // tenant safety: ensure company belongs to tenant
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Customer company not found');

    const email = this.normalizeEmail(input.email);
    if (!email) throw new BadRequestException('email is required');

    const name = input.name !== undefined ? String(input.name).trim() : undefined;
    const sendInvite = input.sendInvite !== false;

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email },
        update: {
          ...(name !== undefined && { name: name || null }),
          customerCompanyId: companyId,
        },
        create: {
          email,
          name: name ? name : null,
          customerCompanyId: companyId,
        },
      });

      const membership = await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        update: {
          role: Role.CUSTOMER,
          status: sendInvite ? MembershipStatus.Invited : MembershipStatus.Active,
        },
        create: {
          tenantId,
          userId: user.id,
          role: Role.CUSTOMER,
          status: sendInvite ? MembershipStatus.Invited : MembershipStatus.Active,
        },
      });

      return { user, membership };
    });

    if (sendInvite) {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.auth.admin.inviteUserByEmail(email);
      if (error) {
        throw new BadRequestException(`Supabase invite failed: ${error.message}`);
      }
    }

    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      status: result.membership.status,
    };
  }
}