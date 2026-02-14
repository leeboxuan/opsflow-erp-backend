import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipStatus, Role } from '@prisma/client';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantIdHeader = request.headers['x-tenant-id'];
    const user = request.user;

    if (!user || !user.userId) {
      throw new ForbiddenException('User must be authenticated first');
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
        throw new BadRequestException('Tenant not found');
      }
      const membership = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId: tenantIdHeader,
          userId: user.userId,
          status: MembershipStatus.Active,
        },
      });
      request.tenant = {
        tenantId: tenantIdHeader,
        role: membership?.role ?? Role.ADMIN,
        isSuperadmin: true,
      };
      return true;
    }

    // Non-superadmin: X-Tenant-Id required and user must be an active member
    if (!tenantIdHeader) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId: tenantIdHeader,
        userId: user.userId,
        status: MembershipStatus.Active,
      },
      include: {
        tenant: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'User is not a member of this tenant or membership is not Active',
      );
    }

     // After membership is found...
     const tenantContext: any = {
      tenantId: tenantIdHeader,
      role: membership.role,
      isSuperadmin: false,
    };

    // ✅ If CUSTOMER, attach customerCompanyId (+ enforce it exists)
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

      tenantContext.customerCompanyId = u.customerCompanyId;
      tenantContext.customerContactId = u.customerContactId ?? null;
    }

    request.tenant = tenantContext;
    return true;


    return true;
  }
}
