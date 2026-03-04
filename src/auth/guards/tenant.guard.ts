import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { MembershipStatus, Role } from "@prisma/client";

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantIdHeader = request.headers["x-tenant-id"];
    const user = request.user;

    if (!user || !user.userId) {
      throw new ForbiddenException("User must be authenticated first");
    }

    // Superadmin (from JWT app_metadata) is not tenant-bound: X-Tenant-Id is optional
    if (user.isSuperadmin) {
      if (!tenantIdHeader) {
        request.tenant = {
          tenantId: null,
          role: Role.ADMIN,
          isSuperadmin: true,
        };
        return true;
      }

      // Superadmin with tenant header: act in that tenant's context
      const tenant = await this.prisma.tenant.findFirst({
        where: { id: tenantIdHeader },
      });
      if (!tenant) {
        throw new BadRequestException("Tenant not found");
      }

      // NOTE: superadmin can act even without membership,
      // but if membership exists, we attach role (and enforce suspension if present)
      const membership = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId: tenantIdHeader,
          userId: user.userId,
        },
        select: { role: true, status: true },
      });

      if (membership?.status === MembershipStatus.Suspended) {
        throw new ForbiddenException("Account suspended");
      }

      request.tenant = {
        tenantId: tenantIdHeader,
        role: membership?.role ?? Role.ADMIN,
        isSuperadmin: true,
      };
      return true;
    }

    // Non-superadmin: X-Tenant-Id required
    if (!tenantIdHeader) {
      throw new BadRequestException("X-Tenant-Id header is required");
    }

    // IMPORTANT CHANGE:
    // - Do NOT filter by status: Active here.
    // - We want to detect Suspended and give a specific error immediately.
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId: tenantIdHeader,
        userId: user.userId,
      },
      include: {
        tenant: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException("User is not a member of this tenant");
    }

    if (membership.status !== MembershipStatus.Active) {
      // This is your “instant kick”
      throw new ForbiddenException(
        `Membership is not Active (${membership.status})`,
      );
    }

    const tenantContext: any = {
      tenantId: tenantIdHeader,
      role: membership.role,
      isSuperadmin: false,
    };

    // ✅ If CUSTOMER, attach customerCompanyId (+ enforce it exists)
    // ✅ ALSO enforce company isActive = true (company suspension = instant kick)
    if (membership.role === Role.CUSTOMER) {
      const u = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { customerCompanyId: true, customerContactId: true },
      });

      if (!u?.customerCompanyId) {
        throw new ForbiddenException(
          "CUSTOMER user is missing customerCompanyId. Admin must link them to a customer company.",
        );
      }

      const company = await this.prisma.customer_companies.findFirst({
        where: { id: u.customerCompanyId, tenantId: tenantIdHeader },
        select: { isActive: true },
      });

      if (!company || company.isActive === false) {
        throw new ForbiddenException("Customer company is suspended");
      }

      tenantContext.customerCompanyId = u.customerCompanyId;
      tenantContext.customerContactId = u.customerContactId ?? null;
    }

    request.tenant = tenantContext;
    return true;
  }
}