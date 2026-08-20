import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CanonicalTenantRole, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import {
  ApproveTripExpenseDto,
  ListTripExpensesQueryDto,
  RejectTripExpenseDto,
  RequestTripExpenseClarificationDto,
} from "./dto/trip-expense.dto";
import { TripExpensesService } from "./trip-expenses.service";

@ApiTags("Finance")
@Controller("finance/trip-expenses")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.FINANCE)
@Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
@ApiBearerAuth("JWT-auth")
export class TripExpensesController {
  constructor(private readonly expenses: TripExpensesService) {}

  @Get()
  list(@Req() req: any, @Query() query: ListTripExpensesQueryDto) {
    return this.expenses.listForFinance(req.tenant.tenantId, query);
  }

  @Get(":expenseId")
  getOne(@Req() req: any, @Param("expenseId") expenseId: string) {
    return this.expenses.getForFinance(req.tenant.tenantId, expenseId);
  }

  @Get(":expenseId/events")
  listEvents(@Req() req: any, @Param("expenseId") expenseId: string) {
    return this.expenses.listEvents(req.tenant.tenantId, expenseId);
  }

  @Get(":expenseId/attachments/:attachmentId/signed-url")
  signedUrl(
    @Req() req: any,
    @Param("expenseId") expenseId: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    return this.expenses.getAttachmentSignedUrl(
      req.tenant.tenantId,
      expenseId,
      attachmentId,
    );
  }

  @Post(":expenseId/approve")
  approve(
    @Req() req: any,
    @Param("expenseId") expenseId: string,
    @Body() dto: ApproveTripExpenseDto,
  ) {
    return this.expenses.approve(
      req.tenant.tenantId,
      expenseId,
      req.user.userId,
      dto ?? {},
    );
  }

  @Post(":expenseId/reject")
  reject(
    @Req() req: any,
    @Param("expenseId") expenseId: string,
    @Body() dto: RejectTripExpenseDto,
  ) {
    return this.expenses.reject(
      req.tenant.tenantId,
      expenseId,
      req.user.userId,
      dto,
    );
  }

  @Post(":expenseId/request-clarification")
  requestClarification(
    @Req() req: any,
    @Param("expenseId") expenseId: string,
    @Body() dto: RequestTripExpenseClarificationDto,
  ) {
    return this.expenses.requestClarification(
      req.tenant.tenantId,
      expenseId,
      req.user.userId,
      dto,
    );
  }

  @Post(":expenseId/reimbursement/mark-paid")
  markPaid(@Req() req: any, @Param("expenseId") expenseId: string) {
    return this.expenses.markReimbursementPaid(
      req.tenant.tenantId,
      expenseId,
      req.user.userId,
    );
  }
}
