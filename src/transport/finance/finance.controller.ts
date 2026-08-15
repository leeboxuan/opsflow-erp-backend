import { Controller, Get, GoneException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CanonicalTenantRole, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";

/**
 * Retired wallet ledger HTTP surface. Canonical earnings:
 * GET /finance/driver-incentives (TripPayoutLine resolver).
 */
@ApiTags("Finance")
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.FINANCE)
@Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
@Controller("finance")
export class FinanceController {
  @Get("wallets")
  async getWalletSummaries() {
    throw new GoneException(
      "GET /finance/wallets is retired. Use GET /finance/driver-incentives (TripPayoutLine).",
    );
  }

  @Get("wallets/:driverId")
  async getWalletTransactions() {
    throw new GoneException(
      "GET /finance/wallets/:driverId is retired. Use GET /finance/driver-incentives/:driverId.",
    );
  }
}
