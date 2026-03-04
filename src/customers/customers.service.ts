import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Role, MembershipStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  CreateCustomerCompanyUserDto,
  ListCompaniesQueryDto,
  ListContactsQueryDto,
} from "./dto/customers.dto";
import {
  CreateCustomerCompanyDto,
  UpdateCustomerCompanyDto,
} from "./dto/customers.dto";
import { createClient } from "@supabase/supabase-js";

@Injectable()
export class CustomersService {
  private supabaseAdmin;

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService
  ) {

    const supabaseUrl =
    this.configService.get<string>("SUPABASE_PROJECT_URL") ||
    this.configService.get<string>("SUPABASE_URL");

  const serviceRoleKey = this.configService.get<string>("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY must be configured");
  }

  this.supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  }

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
    dto: CreateCustomerCompanyUserDto,
  ) {
    const email = dto.email?.trim().toLowerCase();
    const name = dto.name?.trim() || null;
    const password = dto.password;
  
    if (!email) throw new BadRequestException("Email is required");
    if (!password || password.length < 8) throw new BadRequestException("Password must be at least 8 characters");
  
    // tenant-safe company check
    const company = await this.prisma.customerCompany.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
  
    if (!company) throw new NotFoundException("Customer company not found");
  
    // Create Supabase Auth user directly (no invite email)
    const { data, error } = await this.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: name ?? undefined,
        tenantId,
        companyId,
        role: "CUSTOMER",
      },
    });
  
    if (error) {
      throw new BadRequestException(error.message);
    }
  
    const authUserId = data.user?.id;
    if (!authUserId) throw new BadRequestException("Failed to create auth user");
  
    // Create/Upsert internal user + membership
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.upsert({
        where: { email },
        update: {
          authUserId,
          name: name ?? undefined,
          role: Role.CUSTOMER,
          customerCompanyId: companyId,
        },
        create: {
          authUserId,
          email,
          name: name ?? email,
          role: Role.CUSTOMER,
          customerCompanyId: companyId,
        },
      });
  
      // only if you have tenantMembership table:
      await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId, userId: u.id } },
        update: { role: Role.CUSTOMER, status: "Active" },
        create: { tenantId, userId: u.id, role: Role.CUSTOMER, status: "Active" },
      });
  
      return u;
    });
  
    return {
      id: user.id,
      authUserId,
      email: user.email,
      name: user.name,
      status: "ACTIVE",
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
