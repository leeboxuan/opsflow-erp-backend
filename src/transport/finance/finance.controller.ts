import {
    Controller,
    Get,
    Param,
    Query,
    Request,
    UseGuards,
  } from '@nestjs/common';
  import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
  import { TenantModule } from '@prisma/client';
  import { FinanceService } from './finance.service';
  import { AuthGuard } from '../../shared/auth/guards/auth.guard';
  import { TenantGuard } from '../../shared/auth/guards/tenant.guard';
  import {
    ModuleEntitlementGuard,
    RequiresTenantModule,
  } from '../../shared/auth/guards/module-entitlement.guard';
  
  @ApiTags('Finance')
  @ApiBearerAuth()
  @UseGuards(AuthGuard, TenantGuard, ModuleEntitlementGuard)
  @RequiresTenantModule(TenantModule.FINANCE)
  @Controller('finance')
  export class FinanceController {
    constructor(private readonly financeService: FinanceService) {}
  
    @Get('wallets')
    async getWalletSummaries(
      @Request() req: any,
      @Query('month') month?: string,
    ) {
      const tenantId = req.tenant.tenantId;
  
      return this.financeService.getDriverWalletSummaries(
        tenantId,
        month,
      );
    }
  
    @Get('wallets/:driverId')
    async getWalletTransactions(
      @Request() req: any,
      @Param('driverId') driverId: string,
      @Query('month') month?: string,
    ) {
      const tenantId = req.tenant.tenantId;
  
      return this.financeService.getDriverWalletTransactions(
        tenantId,
        driverId,
        month,
      );
    }
  }
