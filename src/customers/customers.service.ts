import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Role, MembershipStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  ListCompaniesQueryDto,
  ListContactsQueryDto,
} from "./dto/customers.dto";
import {
  CreateCustomerCompanyDto,
  UpdateCustomerCompanyDto,
} from "./dto/customers.dto";

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private normalizeCompanyName(name: string): string {
    return String(name ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  private normalizeEmail(email: string): string {
    return String(email ?? "")
      .trim()
      .toLowerCase();
  }

  async searchCompanies(tenantId: string, query: ListCompaniesQueryDto) {
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const searchRaw = String(query.search ?? "").trim();

    const where: any = { tenantId };

    if (searchRaw) {
      const normalized = this.normalizeCompanyName(searchRaw);
      where.OR = [
        { normalizedName: { contains: normalized } },
        { name: { contains: searchRaw, mode: "insensitive" } },
      ];
    }

    const companies = await this.prisma.customer_companies.findMany({
      where,
      orderBy: { name: "asc" },
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

  async listContacts(
    tenantId: string,
    companyId: string,
    query: ListContactsQueryDto,
  ) {
    // tenant safety: ensure company belongs to tenant
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const limit = Math.min(Number(query.limit ?? 20), 100);
    const searchRaw = String(query.search ?? "").trim();

    const where: any = { companyId };

    if (searchRaw) {
      const normalizedEmail = this.normalizeEmail(searchRaw);
      where.OR = [
        { normalizedEmail: { contains: normalizedEmail } },
        { email: { contains: searchRaw, mode: "insensitive" } },
        { name: { contains: searchRaw, mode: "insensitive" } },
      ];
    }

    const contacts = await this.prisma.customer_contacts.findMany({
      where,
      orderBy: [{ name: "asc" }, { email: "asc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return contacts;
  }

  async createCompany(tenantId: string, dto: CreateCustomerCompanyDto) {
    const companyName = String(dto.name ?? "").trim();
    if (!companyName) throw new BadRequestException("name is required");

    const normalizedName = this.normalizeCompanyName(companyName);

    const billingSameAs = !!dto.billingSameAsAddress;

    const company = await this.prisma.customer_companies.upsert({
      where: {
        tenantId_normalizedName: { tenantId, normalizedName },
      },
      update: {
        name: companyName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,

        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        postalCode: dto.postalCode ?? null,
        country: dto.country ?? "SG",

        billingSameAsAddress: billingSameAs,
        billingAddressLine1: billingSameAs
          ? (dto.addressLine1 ?? null)
          : (dto.billingAddressLine1 ?? null),
        billingAddressLine2: billingSameAs
          ? (dto.addressLine2 ?? null)
          : (dto.billingAddressLine2 ?? null),
        billingPostalCode: billingSameAs
          ? (dto.postalCode ?? null)
          : (dto.billingPostalCode ?? null),
        billingCountry: billingSameAs
          ? (dto.country ?? "SG")
          : (dto.billingCountry ?? "SG"),

        picName: dto.picName ?? null,
        picMobile: dto.picMobile ?? null,
        picEmail: dto.picEmail ?? null,

        uen: dto.uen ?? null,
        notes: dto.notes ?? null,
        isActive: dto.isActive ?? true,
      },
      create: {
        tenantId,
        name: companyName,
        normalizedName,

        email: dto.email ?? null,
        phone: dto.phone ?? null,

        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        postalCode: dto.postalCode ?? null,
        country: dto.country ?? "SG",

        billingSameAsAddress: billingSameAs,
        billingAddressLine1: billingSameAs
          ? (dto.addressLine1 ?? null)
          : (dto.billingAddressLine1 ?? null),
        billingAddressLine2: billingSameAs
          ? (dto.addressLine2 ?? null)
          : (dto.billingAddressLine2 ?? null),
        billingPostalCode: billingSameAs
          ? (dto.postalCode ?? null)
          : (dto.billingPostalCode ?? null),
        billingCountry: billingSameAs
          ? (dto.country ?? "SG")
          : (dto.billingCountry ?? "SG"),

        picName: dto.picName ?? null,
        picMobile: dto.picMobile ?? null,
        picEmail: dto.picEmail ?? null,

        uen: dto.uen ?? null,
        notes: dto.notes ?? null,
        isActive: dto.isActive ?? true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        postalCode: true,
        country: true,
        billingSameAsAddress: true,
        billingAddressLine1: true,
        billingAddressLine2: true,
        billingPostalCode: true,
        billingCountry: true,
        picName: true,
        picMobile: true,
        picEmail: true,
        uen: true,
        notes: true,
        isActive: true,
        _count: { select: { contacts: true, users: true } },
      },
    });

    return {
      ...company,
      contactCount: company._count.contacts,
      userCount: company._count.users,
    };
  }

  async createContact(
    tenantId: string,
    companyId: string,
    input: { name: string; email: string; mobile?: string },
  ) {
    // tenant safety: ensure company belongs to tenant
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const contactName = String(input.name ?? "").trim();
    const email = this.normalizeEmail(input.email);
    if (!contactName) throw new BadRequestException("name is required");
    if (!email) throw new BadRequestException("email is required");

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
    if (!company) throw new NotFoundException("Customer company not found");

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        role: Role.CUSTOMER,
        user: {
          customerCompanyId: companyId,
        },
      },
      include: { user: true },
      orderBy: { user: { email: "asc" } },
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
    if (!company) throw new NotFoundException("Customer company not found");

    const email = this.normalizeEmail(input.email);
    if (!email) throw new BadRequestException("email is required");

    const name =
      input.name !== undefined ? String(input.name).trim() : undefined;
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
          status: sendInvite
            ? MembershipStatus.Invited
            : MembershipStatus.Active,
        },
        create: {
          tenantId,
          userId: user.id,
          role: Role.CUSTOMER,
          status: sendInvite
            ? MembershipStatus.Invited
            : MembershipStatus.Active,
        },
      });

      return { user, membership };
    });

    if (sendInvite) {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.auth.admin.inviteUserByEmail(email);
      if (error) {
        throw new BadRequestException(
          `Supabase invite failed: ${error.message}`,
        );
      }
    }

    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      status: result.membership.status,
    };
  }

  async getCompany(tenantId: string, companyId: string) {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        postalCode: true,
        country: true,
        billingSameAsAddress: true,
        billingAddressLine1: true,
        billingAddressLine2: true,
        billingPostalCode: true,
        billingCountry: true,
        picName: true,
        picMobile: true,
        picEmail: true,
        uen: true,
        notes: true,
        isActive: true,
        _count: { select: { contacts: true, users: true } },
      },
    });

    if (!company) throw new NotFoundException("Customer company not found");

    return {
      ...company,
      contactCount: company._count.contacts,
      userCount: company._count.users,
    };
  }

  async updateCompany(
    tenantId: string,
    companyId: string,
    dto: UpdateCustomerCompanyDto,
  ) {
    const existing = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Customer company not found");

    const billingSameAs = dto.billingSameAsAddress;

    const updated = await this.prisma.customer_companies.update({
      where: { id: companyId },
      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name?.trim() || "",
              normalizedName: this.normalizeCompanyName(dto.name),
            }
          : {}),

        ...(dto.email !== undefined ? { email: dto.email ?? null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone ?? null } : {}),

        ...(dto.addressLine1 !== undefined
          ? { addressLine1: dto.addressLine1 ?? null }
          : {}),
        ...(dto.addressLine2 !== undefined
          ? { addressLine2: dto.addressLine2 ?? null }
          : {}),
        ...(dto.postalCode !== undefined
          ? { postalCode: dto.postalCode ?? null }
          : {}),
        ...(dto.country !== undefined ? { country: dto.country ?? "SG" } : {}),

        ...(billingSameAs !== undefined
          ? { billingSameAsAddress: !!billingSameAs }
          : {}),

        ...(dto.billingAddressLine1 !== undefined
          ? { billingAddressLine1: dto.billingAddressLine1 ?? null }
          : {}),
        ...(dto.billingAddressLine2 !== undefined
          ? { billingAddressLine2: dto.billingAddressLine2 ?? null }
          : {}),
        ...(dto.billingPostalCode !== undefined
          ? { billingPostalCode: dto.billingPostalCode ?? null }
          : {}),
        ...(dto.billingCountry !== undefined
          ? { billingCountry: dto.billingCountry ?? "SG" }
          : {}),

        ...(dto.picName !== undefined ? { picName: dto.picName ?? null } : {}),
        ...(dto.picMobile !== undefined
          ? { picMobile: dto.picMobile ?? null }
          : {}),
        ...(dto.picEmail !== undefined
          ? { picEmail: dto.picEmail ?? null }
          : {}),

        ...(dto.uen !== undefined ? { uen: dto.uen ?? null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes ?? null } : {}),
        ...(dto.isActive !== undefined ? { isActive: !!dto.isActive } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        postalCode: true,
        country: true,
        billingSameAsAddress: true,
        billingAddressLine1: true,
        billingAddressLine2: true,
        billingPostalCode: true,
        billingCountry: true,
        picName: true,
        picMobile: true,
        picEmail: true,
        uen: true,
        notes: true,
        isActive: true,
        _count: { select: { contacts: true, users: true } },
      },
    });

    return {
      ...updated,
      contactCount: updated._count.contacts,
      userCount: updated._count.users,
    };
  }
}
