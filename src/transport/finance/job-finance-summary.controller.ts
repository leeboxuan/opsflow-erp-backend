import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CanonicalTenantRole, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { Roles } from "../../shared/auth/guards/role.guard";
import { StrictCanonicalRoleGuard } from "../../shared/auth/guards/strict-canonical-role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { ListJobFinanceSummariesQueryDto } from "./dto/job-finance-summary.dto";
import { JobFinanceSummaryService } from "./job-finance-summary.service";

@ApiTags("Finance")
@Controller("finance/jobs")
@UseGuards(AuthGuard, TenantGuard, StrictCanonicalRoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.FINANCE)
@Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
@ApiBearerAuth("JWT-auth")
export class JobFinanceSummaryController {
  constructor(private readonly summaries: JobFinanceSummaryService) {}

  @Get("summaries")
  list(@Req() req: any, @Query() query: ListJobFinanceSummariesQueryDto) {
    return this.summaries.listSummaries(req.tenant.tenantId, query);
  }

  @Get(":jobId/summary")
  getOne(@Req() req: any, @Param("jobId") jobId: string) {
    return this.summaries.getForJob(req.tenant.tenantId, jobId);
  }
}
