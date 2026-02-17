import {
    Controller,
    Get,
    Param,
    Query,
    Request,
    UseGuards,
  } from '@nestjs/common';
  import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
  import { FinanceService } from './finance.service';
  import { AuthGuard } from '../auth/guards/auth.guard';
  
  @ApiTags('Finance')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
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
  