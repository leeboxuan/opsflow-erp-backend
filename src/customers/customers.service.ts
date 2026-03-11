import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MembershipStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  CreateCustomerCompanyUserDto,
  ListCompaniesQueryDto,
  ListContactsQueryDto,
  CreateCustomerCompanyDto,
  UpdateCustomerCompanyDto,
} from "./dto/customers.dto";
import { parsePaginationFromQuery, buildPaginationMeta } from "../common/pagination";
import { createClient } from "@supabase/supabase-js";
import { applyMappedFilter } from "../common/listing/listing.filters";
import { buildOrderBy } from "../common/listing/listing.sort";
import { applyQSearch } from "../common/listing/listing.search";

@Injectable()
export class CustomersService {
  private supabaseAdmin;

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    const supabaseUrl =
      this.configService.get<string>("SUPABASE_PROJECT_URL") ||
      this.configService.get<string>("SUPABASE_URL");

    const serviceRoleKey = this.configService.get<string>(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY must be configured",
      );
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
    return String(email ?? "").trim().toLowerCase();
  }

  async searchCompanies(
    tenantId: string,
    query: ListCompaniesQueryDto,
  ): Promise<{
    data: Array<{
      id: string;
      name: string;
      isActive: boolean;
      picMobile: string | null;
      createdAt: Date;
      contactCount: number;
      userCount: number;
    }>;
    meta: { page: number; pageSize: number; total: number };
  }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const where: any = { tenantId };

    const q = (query.q ?? query.search)?.trim();
    applyQSearch(where, q, ["name", "normalizedName"]);
    applyMappedFilter(where, query.filter, {
      active: { isActive: true },
      inactive: { isActive: false },
      suspended: { isActive: false },
    });

    const orderBy = buildOrderBy(query.sortBy, query.sortDir, ["name", "normalizedName", "isActive", "createdAt"], { name: "asc" });

    const select = {
      id: true,
      name: true,
      isActive: true,
      picMobile: true,
      createdAt: true,
      _count: { select: { contacts: true, users: true } },
    };

    const [total, companies] = await this.prisma.$transaction([
      this.prisma.customer_companies.count({ where }),
      this.prisma.customer_companies.findMany({
        where,
        orderBy,
        skip,
        take,
        select,
      }),
    ]);

    const data = companies.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      picMobile: c.picMobile,
      createdAt: c.createdAt,
      contactCount: c._count.contacts,
      userCount: c._count.users,
    }));

    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  async listContacts(
    tenantId: string,
    companyId: string,
    query: ListContactsQueryDto,
  ): Promise<{
    data: Array<{ id: string; name: string; email: string }>;
    meta: { page: number; pageSize: number; total: number };
  }> {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const where: any = { companyId };

    const q = (query.q ?? query.search)?.trim();
    applyQSearch(where, q, ["name", "email", "normalizedEmail"]);

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      ["name", "email", "createdAt"],
      { name: "asc" },
    );

    const select = { id: true, name: true, email: true };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer_contacts.count({ where }),
      this.prisma.customer_contacts.findMany({
        where,
        orderBy,
        skip,
        take,
        select,
      }),
    ]);

    return { data: rows, meta: buildPaginationMeta(page, pageSize, total) };
  }

  async createCompany(tenantId: string, dto: CreateCustomerCompanyDto) {
    const companyName = String(dto.name ?? "").trim();
    if (!companyName) throw new BadRequestException("name is required");

    const normalizedName = this.normalizeCompanyName(companyName);
    const billingSameAs = !!dto.billingSameAsAddress;

    const company = await this.prisma.customer_companies.upsert({
      where: { tenantId_normalizedName: { tenantId, normalizedName } },
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
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const contactName = String(input.name ?? "").trim();
    const email = this.normalizeEmail(input.email);
    if (!contactName) throw new BadRequestException("name is required");
    if (!email) throw new BadRequestException("email is required");

    return this.prisma.customer_contacts.upsert({
      where: { companyId_normalizedEmail: { companyId, normalizedEmail: email } },
      update: { name: contactName, email },
      create: { companyId, name: contactName, email, normalizedEmail: email },
      select: { id: true, name: true, email: true },
    });
  }

  async listCompanyUsers(tenantId: string, companyId: string) {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        role: Role.CUSTOMER,
        user: { customerCompanyId: companyId },
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
    if (!password || password.length < 8)
      throw new BadRequestException("Password must be at least 8 characters");

    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true, isActive: true },
    });

    if (!company) throw new NotFoundException("Customer company not found");
    if (company.isActive === false)
      throw new BadRequestException("Customer company is suspended");

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

    if (error) throw new BadRequestException(error.message);

    const authUserId = data.user?.id;
    if (!authUserId) throw new BadRequestException("Failed to create auth user");

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

      await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId, userId: u.id } },
        update: { role: Role.CUSTOMER, status: MembershipStatus.Active },
        create: {
          tenantId,
          userId: u.id,
          role: Role.CUSTOMER,
          status: MembershipStatus.Active,
        },
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

  async setCompanyActive(tenantId: string, companyId: string, isActive: boolean) {
    // tenant safety
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true, isActive: true },
    });
  
    if (!company) throw new NotFoundException("Customer company not found");
  
    const updated = await this.prisma.customer_companies.update({
      where: { id: companyId },
      data: { isActive },
      select: { id: true, isActive: true },
    });
  
    // Get all users linked to this company
    const users = await this.prisma.user.findMany({
      where: { customerCompanyId: companyId },
      select: { id: true },
    });
  
    const userIds = users.map((u) => u.id);
  
    if (userIds.length > 0) {
      await this.prisma.tenantMembership.updateMany({
        where: {
          tenantId,
          userId: { in: userIds },
          role: Role.CUSTOMER,
        },
        data: {
          status: isActive ? MembershipStatus.Active : MembershipStatus.Suspended,
        },
      });
    }
  
    return {
      id: updated.id,
      isActive: updated.isActive,
      affectedUsers: userIds.length,
    };
  }

  async setCompanyUserStatus(
    tenantId: string,
    companyId: string,
    targetUserId: string,
    status: MembershipStatus,
  ) {
    // tenant-safe company check
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");
  
    // ensure the user is linked to THIS company
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, customerCompanyId: companyId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new NotFoundException("User not found under this company");
    }
  
    // update membership status (must exist in this tenant and be CUSTOMER)
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: targetUserId,
        role: Role.CUSTOMER,
      },
      select: { id: true },
    });
  
    if (!membership) {
      throw new NotFoundException("Tenant membership not found for this user");
    }
  
    const updated = await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { status },
      select: {
        userId: true,
        status: true,
        role: true,
      },
    });
  
    return {
      userId: updated.userId,
      status: updated.status,
    };
  }
}