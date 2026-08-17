import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  MembershipStatus,
  CanonicalTenantRole,
  QuotationVersionStatus,
  Role,
  TenantModule,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { SupabaseService } from "../shared/auth/supabase.service";
import { AuditService } from "../shared/audit/audit.service";
import { syncMembershipRoleRows } from "../shared/auth/membership-roles";
import {
  CreateCustomerCompanyUserDto,
  CustomerCompanyDocumentDto,
  ListCompaniesQueryDto,
  ListCustomerCompanyDocumentsQueryDto,
  ListContactsQueryDto,
  CreateCustomerCompanyDto,
  UpdateCustomerCompanyDto,
} from "./dto/customers.dto";
import { parsePaginationFromQuery, buildPaginationMeta } from "../shared/common/pagination";
import { createClient } from "@supabase/supabase-js";
import { applyMappedFilter } from "../shared/common/listing/listing.filters";
import { buildOrderBy } from "../shared/common/listing/listing.sort";
import { applyQSearch } from "../shared/common/listing/listing.search";
import { runToleratedSideEffect } from "../shared/side-effects/tolerated-side-effects";
import { RealtimeEventsService } from "../shared/realtime/realtime-events.service";
import * as rt from "../shared/realtime/realtime-publish";
import { RateTemplatesService } from "./rate-templates/rate-templates.service";
import { IdempotencyService } from "../shared/idempotency/idempotency.service";
import { IDEMPOTENCY_SCOPES } from "../shared/idempotency/idempotency.util";
import { hashCustomerOnboardingPayload } from "./onboarding-idempotency.util";

const COMPANY_DOCS_BUCKET = "job-documents";
const INVOICE_DOCUMENTS_BUCKET = "invoice-documents";

const CUSTOMER_COMPANY_DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;

@Injectable()
export class CustomersService {
  private supabaseAdmin;

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: RealtimeEventsService,
    @Optional() private readonly rateTemplates?: RateTemplatesService,
    @Optional() private readonly idempotency?: IdempotencyService,
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

  /** Enabled TenantModule set for projection stripping (not a trust boundary). */
  async getEnabledModules(tenantId: string): Promise<Set<TenantModule>> {
    const rows = await this.prisma.tenantModuleEntitlement.findMany({
      where: { tenantId, enabled: true },
      select: { module: true },
    });
    return new Set(rows.map((r) => r.module));
  }

  /**
   * Shared customer identity stays module-neutral; strip FINANCE-owned document
   * rows (invoice PDFs) when FINANCE is disabled so counts/lists cannot leak.
   */
  private applyModuleDocumentProjection(where: any, enabled: Set<TenantModule>) {
    if (!enabled.has(TenantModule.FINANCE)) {
      const financeExclude = {
        AND: [
          { type: { notIn: ["INVOICE", "COMPANY_INVOICE"] } },
          { sourceInvoiceId: null },
        ],
      };
      if (!where.AND) {
        where.AND = [financeExclude];
      } else if (Array.isArray(where.AND)) {
        where.AND.push(financeExclude);
      } else {
        where.AND = [where.AND, financeExclude];
      }
    }
    return where;
  }

  /**
   * Hide finance-owned docs when FINANCE disabled — same 404 as missing to
   * avoid existence leaks via error differences.
   */
  private async assertDocumentVisibleUnderModules(
    tenantId: string,
    row: { type?: string | null; sourceInvoiceId?: string | null },
  ): Promise<void> {
    const enabled = await this.getEnabledModules(tenantId);
    if (enabled.has(TenantModule.FINANCE)) return;
    const type = String(row?.type ?? "").toUpperCase();
    if (
      type === "INVOICE" ||
      type === "COMPANY_INVOICE" ||
      String(row?.sourceInvoiceId ?? "").trim()
    ) {
      throw new NotFoundException("Customer company document not found");
    }
  }

  async searchCompanies(
    tenantId: string,
    query: ListCompaniesQueryDto,
  ): Promise<{
    data: Array<{
      id: string;
      name: string;
      isActive: boolean;
      commercialStatus?: string;
        picName: string | null;
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
      commercialStatus: true,
      picName: true,
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
      commercialStatus: c.commercialStatus,
      picName: c.picName,
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

  private companyWriteSelect() {
    return {
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
      commercialStatus: true,
      _count: { select: { contacts: true, users: true } },
    } as const;
  }

  private companyWritePayload(
    tenantId: string,
    dto: CreateCustomerCompanyDto,
    companyName: string,
    normalizedName: string,
  ) {
    const billingSameAs = !!dto.billingSameAsAddress;
    const commercialStatus = dto.commercialStatus ?? "PROSPECT";
    const isActive =
      dto.isActive !== undefined
        ? !!dto.isActive
        : commercialStatus !== "SUSPENDED";
    const shared = {
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
      isActive,
      commercialStatus,
    };
    return {
      update: shared,
      create: { tenantId, normalizedName, ...shared },
    };
  }

  private mapSeededRateTemplate(seeded: {
    id: string;
    name: string;
    rows?: unknown[] | null;
    sourceMasterDatasetId?: string | null;
    sourceMasterDatasetVersionNo?: number | null;
  }) {
    return {
      id: seeded.id,
      name: seeded.name,
      rowCount: seeded.rows?.length ?? 0,
      sourceMasterDatasetVersionNo: seeded.sourceMasterDatasetVersionNo ?? null,
      sourceMasterDatasetId: seeded.sourceMasterDatasetId ?? null,
    };
  }

  async createCompany(
    tenantId: string,
    dto: CreateCustomerCompanyDto,
    actorUserId: string | null = null,
  ) {
    const operationKey = dto.onboardingOperationKey?.trim();
    if (operationKey) {
      return this.createCompanyIdempotent(
        tenantId,
        dto,
        operationKey,
        actorUserId,
      );
    }

    const companyName = String(dto.name ?? "").trim();
    if (!companyName) throw new BadRequestException("name is required");

    const normalizedName = this.normalizeCompanyName(companyName);
    const payload = this.companyWritePayload(
      tenantId,
      dto,
      companyName,
      normalizedName,
    );
    const select = this.companyWriteSelect();

    const existingCompany = await this.prisma.customer_companies.findUnique({
      where: { tenantId_normalizedName: { tenantId, normalizedName } },
      select: { id: true },
    });

    if (existingCompany) {
      const company = await this.prisma.customer_companies.upsert({
        where: { tenantId_normalizedName: { tenantId, normalizedName } },
        update: payload.update,
        create: payload.create,
        select,
      });
      rt.publishCustomerEvent(
        this.realtime,
        "customer.updated",
        tenantId,
        company.id,
      );
      return {
        ...company,
        contactCount: company._count.contacts,
        userCount: company._count.users,
        seededCustomerRateTemplate: null,
      };
    }

    const { company, seeded, wasCreate } = await this.prisma.$transaction(
      async (tx) => {
        const raced = await tx.customer_companies.findUnique({
          where: { tenantId_normalizedName: { tenantId, normalizedName } },
          select: { id: true },
        });
        if (raced) {
          const updated = await tx.customer_companies.update({
            where: { id: raced.id },
            data: payload.update,
            select,
          });
          return { company: updated, seeded: null as null, wasCreate: false };
        }

        const created = await tx.customer_companies.create({
          data: payload.create,
          select,
        });
        const seededTemplate =
          this.rateTemplates && !dto.skipDefaultRateTemplate
            ? await this.rateTemplates.seedFromCurrentQuotationBase(
                tenantId,
                created.id,
                actorUserId,
                created.name,
                {
                  client: tx,
                  ...(dto.defaultRateRows !== undefined
                    ? { rows: dto.defaultRateRows }
                    : {}),
                },
              )
            : null;
        return { company: created, seeded: seededTemplate, wasCreate: true };
      },
    );

    if (seeded) {
      await this.audit.log(
        tenantId,
        "CREATE",
        "CustomerRateTemplate",
        seeded.id,
        {
          customerCompanyId: company.id,
          fromMasterDatasetId: seeded.sourceMasterDatasetId,
          versionNo: seeded.sourceMasterDatasetVersionNo,
          rowCount: seeded.rows?.length ?? 0,
          seededOnCustomerCreate: true,
        },
        actorUserId,
      );
    }

    rt.publishCustomerEvent(
      this.realtime,
      wasCreate ? "customer.created" : "customer.updated",
      tenantId,
      company.id,
    );

    return {
      ...company,
      contactCount: company._count.contacts,
      userCount: company._count.users,
      seededCustomerRateTemplate: seeded
        ? this.mapSeededRateTemplate(seeded)
        : null,
    };
  }

  private async loadCustomerCompanyResponse(
    tenantId: string,
    companyId: string,
    seededCustomerRateTemplate: ReturnType<
      CustomersService["mapSeededRateTemplate"]
    > | null = null,
  ) {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: this.companyWriteSelect(),
    });
    if (!company) {
      throw new NotFoundException("Customer company not found");
    }
    return {
      ...company,
      contactCount: company._count.contacts,
      userCount: company._count.users,
      seededCustomerRateTemplate,
    };
  }

  private async createCompanyIdempotent(
    tenantId: string,
    dto: CreateCustomerCompanyDto,
    operationKey: string,
    actorUserId: string | null,
  ) {
    if (!this.idempotency) {
      throw new BadRequestException("Idempotency service unavailable");
    }

    const companyName = String(dto.name ?? "").trim();
    if (!companyName) throw new BadRequestException("name is required");

    const normalizedName = this.normalizeCompanyName(companyName);
    const payload = this.companyWritePayload(
      tenantId,
      dto,
      companyName,
      normalizedName,
    );
    const select = this.companyWriteSelect();
    const requestHash = hashCustomerOnboardingPayload(dto);

    let seededTemplateSideEffect: {
      id: string;
      meta: Record<string, unknown>;
    } | null = null;

    const { result, outcome } = await this.idempotency.execute({
      tenantId,
      scope: IDEMPOTENCY_SCOPES.CUSTOMER_ONBOARDING,
      operationKey,
      requestHash,
      load: (resourceId) =>
        this.loadCustomerCompanyResponse(tenantId, resourceId, null),
      execute: async (tx) => {
        const raced = await tx.customer_companies.findUnique({
          where: { tenantId_normalizedName: { tenantId, normalizedName } },
          select: { id: true },
        });
        if (raced) {
          throw new ConflictException({
            message:
              "A customer with this name already exists for a different onboarding operation",
            code: "CUSTOMER_NAME_CONFLICT",
          });
        }

        const created = await tx.customer_companies.create({
          data: payload.create,
          select,
        });
        const seededTemplate =
          this.rateTemplates && !dto.skipDefaultRateTemplate
            ? await this.rateTemplates.seedFromCurrentQuotationBase(
                tenantId,
                created.id,
                actorUserId,
                created.name,
                {
                  client: tx,
                  ...(dto.defaultRateRows !== undefined
                    ? { rows: dto.defaultRateRows }
                    : {}),
                },
              )
            : null;

        if (seededTemplate) {
          seededTemplateSideEffect = {
            id: seededTemplate.id,
            meta: {
              customerCompanyId: created.id,
              fromMasterDatasetId: seededTemplate.sourceMasterDatasetId,
              versionNo: seededTemplate.sourceMasterDatasetVersionNo,
              rowCount: seededTemplate.rows?.length ?? 0,
              seededOnCustomerCreate: true,
            },
          };
        }

        const response = {
          ...created,
          contactCount: created._count.contacts,
          userCount: created._count.users,
          seededCustomerRateTemplate: seededTemplate
            ? this.mapSeededRateTemplate(seededTemplate)
            : null,
        };

        return {
          resourceType: "customer_companies",
          resourceId: created.id,
          result: response,
        };
      },
    });

    if (outcome === "created") {
      if (seededTemplateSideEffect) {
        await runToleratedSideEffect("customer rate template audit", () =>
          this.audit.log(
            tenantId,
            "CREATE",
            "CustomerRateTemplate",
            seededTemplateSideEffect!.id,
            seededTemplateSideEffect!.meta,
            actorUserId,
          ),
        );
      }
      await runToleratedSideEffect("customer.created realtime", async () => {
        rt.publishCustomerEvent(
          this.realtime,
          "customer.created",
          tenantId,
          result.id,
        );
      });
    }

    return result;
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
        user: { customerCompanyId: companyId },
        OR: [
          { role: Role.CUSTOMER },
          {
            membershipRoles: {
              some: { role: CanonicalTenantRole.CUSTOMER_ADMIN },
            },
          },
        ],
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
    const name = String(dto.name ?? "").trim();
    const password = dto.password;

    if (!email) throw new BadRequestException("Email is required");
    if (!name) throw new BadRequestException("name is required");
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
        name,
        tenantId,
        companyId,
        userRole: "USER",
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
          name,
          // Application-level role: keep as USER; customer access is scoped via TenantMembership.role
          role: UserRole.USER,
          customerCompanyId: companyId,
        },
        create: {
          authUserId,
          email,
          name,
          role: UserRole.USER,
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

      const membership = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId: u.id } },
        select: { id: true },
      });
      if (membership) {
        await syncMembershipRoleRows(
          tx,
          membership.id,
          [CanonicalTenantRole.CUSTOMER_ADMIN],
          null,
        );
      }

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
        commercialStatus: true,
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
        ...(dto.commercialStatus !== undefined
          ? {
              commercialStatus: dto.commercialStatus,
              ...(dto.isActive === undefined
                ? { isActive: dto.commercialStatus !== "SUSPENDED" }
                : {}),
            }
          : {}),
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
        commercialStatus: true,
        _count: { select: { contacts: true, users: true } },
      },
    });

    rt.publishCustomerEvent(this.realtime, "customer.updated", tenantId, companyId);

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
      data: {
        isActive,
        commercialStatus: isActive ? "ACTIVE" : "SUSPENDED",
      },
      select: { id: true, isActive: true, commercialStatus: true },
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
          OR: [
            { role: Role.CUSTOMER },
            {
              membershipRoles: {
                some: { role: CanonicalTenantRole.CUSTOMER_ADMIN },
              },
            },
          ],
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
        OR: [
          { role: Role.CUSTOMER },
          {
            membershipRoles: {
              some: { role: CanonicalTenantRole.CUSTOMER_ADMIN },
            },
          },
        ],
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

  private async assertCustomerCompanyExists(tenantId: string, companyId: string) {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");
  }

  private async attachCustomerDocumentSignedUrl(row: {
    id: string;
    customerCompanyId: string;
    type: string;
    fileName: string;
    fileUrl: string;
    mimeType: string;
    fileSizeBytes: number | null;
    uploadedByUserId: string | null;
    uploadedAt: Date;
    status: string;
    generatedByUserId?: string | null;
    generatedAt?: Date | null;
    sourceJobId?: string | null;
    sourceInvoiceId?: string | null;
    storageBucket?: string | null;
    storageKey?: string | null;
    uploadedBy?: { name: string | null } | null;
    generatedBy?: { name: string | null; email?: string | null } | null;
  }): Promise<CustomerCompanyDocumentDto> {
    const bucket = this.resolveCustomerDocumentBucket(row as any);
    const objectKey = row.storageKey ?? row.fileUrl;
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectKey, CUSTOMER_COMPANY_DOCUMENT_SIGNED_URL_TTL_SECONDS);

    return {
      id: row.id,
      customerCompanyId: row.customerCompanyId,
      type: row.type as "CUSTOMER_DOCUMENT" | "INVOICE" | "COMPANY_INVOICE",
      fileName: row.fileName,
      fileUrl: error ? null : (data?.signedUrl ?? null),
      mimeType: row.mimeType,
      fileSizeBytes: row.fileSizeBytes ?? null,
      uploadedByUserId: row.uploadedByUserId ?? null,
      uploadedByName: row.uploadedBy?.name ?? null,
      generatedByUserId: row.generatedByUserId ?? null,
      generatedByName: row.generatedBy?.name ?? row.generatedBy?.email ?? null,
      generatedAt: row.generatedAt ?? null,
      sourceJobId: row.sourceJobId ?? null,
      sourceInvoiceId: row.sourceInvoiceId ?? null,
      uploadedAt: row.uploadedAt,
      status: row.status as "ACTIVE" | "DELETED",
    };
  }

  private resolveCustomerDocumentBucket(row: {
    type?: string | null;
    sourceInvoiceId?: string | null;
    storageBucket?: string | null;
  }): string {
    const explicit = String((row as any)?.storageBucket ?? "").trim();
    if (explicit) return explicit;
    const type = String(row?.type ?? "").toUpperCase();
    if (
      type === "INVOICE" ||
      type === "COMPANY_INVOICE" ||
      String(row?.sourceInvoiceId ?? "").trim()
    ) {
      return INVOICE_DOCUMENTS_BUCKET;
    }
    return COMPANY_DOCS_BUCKET;
  }

  async listCustomerCompanyDocuments(
    tenantId: string,
    customerCompanyId: string,
    query: ListCustomerCompanyDocumentsQueryDto,
  ): Promise<{
    data: CustomerCompanyDocumentDto[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    return this.listCompanyDocuments(tenantId, customerCompanyId, query);
  }

  async listCompanyDocuments(
    tenantId: string,
    customerCompanyId: string,
    query: ListCustomerCompanyDocumentsQueryDto,
  ): Promise<{
    data: CustomerCompanyDocumentDto[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    await this.assertCustomerCompanyExists(tenantId, customerCompanyId);
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const enabled = await this.getEnabledModules(tenantId);

    const where: any = {
      tenantId,
      customerCompanyId,
      status: "ACTIVE",
    };
    applyQSearch(where, query.q, ["fileName"]);
    this.applyModuleDocumentProjection(where, enabled);

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      ["uploadedAt", "createdAt", "fileName"],
      { uploadedAt: "desc" },
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customerCompanyDocument.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          uploadedBy: { select: { name: true } },
          generatedBy: { select: { name: true, email: true } },
        },
      }),
      this.prisma.customerCompanyDocument.count({ where }),
    ]);

    return {
      data: await Promise.all(rows.map((r) => this.attachCustomerDocumentSignedUrl(r as any))),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async uploadCustomerCompanyDocument(
    tenantId: string,
    customerCompanyId: string,
    file: Express.Multer.File,
    actorUserId: string | null,
  ): Promise<CustomerCompanyDocumentDto> {
    await this.assertCustomerCompanyExists(tenantId, customerCompanyId);

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    const key = `${tenantId}/companies/${customerCompanyId}/documents/${Date.now()}${ext}`;

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage.from(COMPANY_DOCS_BUCKET).upload(key, file.buffer, {
      contentType: file.mimetype ?? "application/octet-stream",
      upsert: false,
    });
    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }

    const created = await this.prisma.customerCompanyDocument.create({
      data: {
        tenantId,
        customerCompanyId,
        type: "CUSTOMER_DOCUMENT",
        fileName: file.originalname ?? "document",
        fileUrl: key,
        storageKey: key,
        mimeType: file.mimetype ?? "application/octet-stream",
        fileSizeBytes: file.size ?? null,
        uploadedByUserId: actorUserId ?? null,
        status: "ACTIVE",
      },
      include: { uploadedBy: { select: { name: true } } },
    });

    await this.audit.log(
      tenantId,
      "CUSTOMER_COMPANY_DOCUMENT_UPLOAD",
      "CUSTOMER_COMPANY",
      customerCompanyId,
      { documentId: created.id, fileName: created.fileName, storageKey: created.storageKey },
      actorUserId,
    );

    return this.attachCustomerDocumentSignedUrl(created);
  }

  async getCustomerCompanyDocument(
    tenantId: string,
    customerCompanyId: string,
    documentId: string,
  ): Promise<CustomerCompanyDocumentDto> {
    const row = await this.prisma.customerCompanyDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        customerCompanyId,
        status: "ACTIVE",
      },
      include: {
        uploadedBy: { select: { name: true } },
        generatedBy: { select: { name: true, email: true } },
      },
    });
    if (!row) throw new NotFoundException("Customer company document not found");
    await this.assertDocumentVisibleUnderModules(tenantId, row);
    return this.attachCustomerDocumentSignedUrl(row as any);
  }

  async getCompanyDocument(
    tenantId: string,
    customerCompanyId: string,
    documentId: string,
  ): Promise<CustomerCompanyDocumentDto> {
    const row = await this.prisma.customerCompanyDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        customerCompanyId,
        status: "ACTIVE",
      },
      include: {
        uploadedBy: { select: { name: true } },
        generatedBy: { select: { name: true, email: true } },
      },
    });
    if (!row) throw new NotFoundException("Company document not found");
    await this.assertDocumentVisibleUnderModules(tenantId, row);
    return this.attachCustomerDocumentSignedUrl(row as any);
  }

  async deleteCustomerCompanyDocument(
    tenantId: string,
    customerCompanyId: string,
    documentId: string,
    actorUserId: string | null,
  ): Promise<{ ok: true }> {
    const row = await this.prisma.customerCompanyDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        customerCompanyId,
        status: "ACTIVE",
      },
      select: { id: true, type: true, sourceInvoiceId: true, storageKey: true },
    });
    if (!row) throw new NotFoundException("Customer company document not found");

    const supabase = this.supabaseService.getClient();
    await supabase.storage
      .from(this.resolveCustomerDocumentBucket(row as any))
      .remove([row.storageKey]);

    await this.prisma.customerCompanyDocument.update({
      where: { id: row.id },
      data: { status: "DELETED" },
    });

    await this.audit.log(
      tenantId,
      "CUSTOMER_COMPANY_DOCUMENT_DELETE",
      "CUSTOMER_COMPANY",
      customerCompanyId,
      { documentId: row.id, storageKey: row.storageKey },
      actorUserId,
    );

    return { ok: true };
  }

  async deleteCompanyDocument(
    tenantId: string,
    customerCompanyId: string,
    documentId: string,
    actorUserId: string | null,
  ): Promise<{ ok: true }> {
    const row = await this.prisma.customerCompanyDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        customerCompanyId,
        status: "ACTIVE",
      },
      select: { id: true, type: true, sourceInvoiceId: true, storageKey: true },
    });
    if (!row) throw new NotFoundException("Company document not found");

    const supabase = this.supabaseService.getClient();
    await supabase.storage
      .from(this.resolveCustomerDocumentBucket(row as any))
      .remove([row.storageKey]);
    await this.prisma.customerCompanyDocument.update({
      where: { id: row.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    await this.audit.log(
      tenantId,
      "COMPANY_DOCUMENT_DELETE",
      "CUSTOMER_COMPANY",
      customerCompanyId,
      { documentId: row.id, storageKey: row.storageKey },
      actorUserId,
    );
    return { ok: true };
  }

  async getCustomerCompanyDocumentDownloadUrl(
    tenantId: string,
    customerCompanyId: string,
    documentId: string,
  ): Promise<{ url: string | null; expiresInSeconds: number }> {
    const row = await this.prisma.customerCompanyDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        customerCompanyId,
        status: "ACTIVE",
      },
      select: { type: true, sourceInvoiceId: true, storageKey: true, fileUrl: true },
    });
    if (!row) throw new NotFoundException("Customer company document not found");
    await this.assertDocumentVisibleUnderModules(tenantId, row);

    const supabase = this.supabaseService.getClient();
    const bucket = this.resolveCustomerDocumentBucket(row as any);
    const objectKey = row.storageKey ?? row.fileUrl;
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectKey, CUSTOMER_COMPANY_DOCUMENT_SIGNED_URL_TTL_SECONDS);

    return {
      url: error ? null : (data?.signedUrl ?? null),
      expiresInSeconds: CUSTOMER_COMPANY_DOCUMENT_SIGNED_URL_TTL_SECONDS,
    };
  }

  async getCompanyDocumentDownloadUrl(
    tenantId: string,
    customerCompanyId: string,
    documentId: string,
  ): Promise<{ url: string | null; expiresInSeconds: number }> {
    const row = await this.prisma.customerCompanyDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        customerCompanyId,
        status: "ACTIVE",
      },
      select: { type: true, sourceInvoiceId: true, storageKey: true, fileUrl: true },
    });
    if (!row) throw new NotFoundException("Company document not found");
    await this.assertDocumentVisibleUnderModules(tenantId, row);
    const supabase = this.supabaseService.getClient();
    const bucket = this.resolveCustomerDocumentBucket(row as any);
    const objectKey = row.storageKey ?? row.fileUrl;
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectKey, CUSTOMER_COMPANY_DOCUMENT_SIGNED_URL_TTL_SECONDS);
    return {
      url: error ? null : (data?.signedUrl ?? null),
      expiresInSeconds: CUSTOMER_COMPANY_DOCUMENT_SIGNED_URL_TTL_SECONDS,
    };
  }

  async updateCompanyDocumentMetadata(
    tenantId: string,
    customerCompanyId: string,
    documentId: string,
    dto: { fileName?: string | null },
  ): Promise<CustomerCompanyDocumentDto> {
    const row = await this.prisma.customerCompanyDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        customerCompanyId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Company document not found");
    const updated = await this.prisma.customerCompanyDocument.update({
      where: { id: row.id },
      data: {
        ...(dto.fileName !== undefined ? { fileName: String(dto.fileName ?? "").trim() || "document" } : {}),
      },
      include: {
        uploadedBy: { select: { name: true } },
        generatedBy: { select: { name: true, email: true } },
      },
    });
    return this.attachCustomerDocumentSignedUrl(updated as any);
  }

  private async putCompanyQuotationObject(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage
      .from(COMPANY_DOCS_BUCKET)
      .upload(storageKey, buffer, {
        contentType,
        upsert: false,
      });
    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }
  }

  private async attachQuotationSignedUrl(q: {
    id: string;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number | null;
    effectiveDate: Date | null;
    status: QuotationVersionStatus;
    createdAt: Date;
    parsedSummaryJson: unknown;
  }) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(COMPANY_DOCS_BUCKET)
      .createSignedUrl(q.storageKey, 60 * 60);
    return {
      id: q.id,
      originalName: q.originalName,
      mimeType: q.mimeType,
      sizeBytes: q.sizeBytes ?? null,
      effectiveDate: q.effectiveDate,
      status: q.status,
      createdAt: q.createdAt,
      parsedSummaryJson: q.parsedSummaryJson ?? null,
      url: error ? null : (data?.signedUrl ?? null),
    };
  }

  async uploadCompanyQuotation(
    tenantId: string,
    companyId: string,
    file: Express.Multer.File,
    actorUserId: string | null,
    effectiveDateIso?: string | null,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("file is required");
    }
    const originalName = String(file.originalname ?? "").toLowerCase();
    const mime = String(file.mimetype ?? "").toLowerCase();
    const isPdf = originalName.endsWith(".pdf") || mime === "application/pdf";
    if (!isPdf) {
      throw new BadRequestException("Signed quotation must be a PDF file");
    }

    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const effectiveDate =
      effectiveDateIso && String(effectiveDateIso).trim()
        ? new Date(String(effectiveDateIso).trim() + "T00:00:00.000Z")
        : null;
    if (effectiveDateIso && effectiveDate && Number.isNaN(effectiveDate.getTime())) {
      throw new BadRequestException("effectiveDate must be YYYY-MM-DD");
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".bin";
    const key = `${tenantId}/companies/${companyId}/quotations/${Date.now()}${ext}`;

    await this.putCompanyQuotationObject(
      key,
      file.buffer,
      file.mimetype ?? "application/octet-stream",
    );

    const quotation = await this.prisma.$transaction(async (tx) => {
      await tx.customerCompanyQuotation.updateMany({
        where: {
          tenantId,
          customerCompanyId: companyId,
          status: QuotationVersionStatus.ACTIVE,
        },
        data: { status: QuotationVersionStatus.SUPERSEDED },
      });

      const q = await tx.customerCompanyQuotation.create({
        data: {
          tenantId,
          customerCompanyId: companyId,
          storageKey: key,
          originalName: file.originalname ?? "quotation",
          mimeType: file.mimetype ?? "application/octet-stream",
          sizeBytes: file.size ?? null,
          uploadedByUserId: actorUserId ?? null,
          effectiveDate,
          status: QuotationVersionStatus.ACTIVE,
          parsedSummaryJson: {
            note: "Signed quotation uploaded for record keeping only (no parsing).",
          } as any,
        },
      });

      return q;
    });

    await this.audit.log(
      tenantId,
      "COMPANY_QUOTATION_UPLOAD",
      "CUSTOMER_COMPANY",
      companyId,
      {
        quotationId: quotation.id,
        storageKey: key,
      },
      actorUserId,
    );

    return this.attachQuotationSignedUrl(quotation);
  }

  async listCompanyQuotations(tenantId: string, companyId: string) {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const rows = await this.prisma.customerCompanyQuotation.findMany({
      where: { tenantId, customerCompanyId: companyId },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(rows.map((r) => this.attachQuotationSignedUrl(r)));
  }

  async getActiveCompanyQuotation(tenantId: string, companyId: string) {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Customer company not found");

    const q = await this.prisma.customerCompanyQuotation.findFirst({
      where: {
        tenantId,
        customerCompanyId: companyId,
        status: QuotationVersionStatus.ACTIVE,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!q) return null;
    return this.attachQuotationSignedUrl(q);
  }

  async listActiveQuotationRateLines(tenantId: string, companyId: string) {
    await this.assertCustomerCompanyExists(tenantId, companyId);
    return [];
  }
}