import {
    Controller,
    Get,
    Param,
    Query,
    Request,
    UseGuards,
  } from '@nestjs/common';
  import {
    ApiBearerAuth,
    ApiOperation,
    ApiQuery,
    ApiTags,
  } from '@nestjs/swagger';
  import { AuthGuard } from '../auth/guards/auth.guard';
  import { TenantGuard } from '../auth/guards/tenant.guard';
  import { CustomersService } from './customers.service';
  import { ListCompaniesQueryDto, ListContactsQueryDto } from './dto/customers.dto';
  import { CustomerCompanyDto, CustomerContactDto } from './dto/customers.dto';
  
  @ApiTags('customers')
  @Controller('customers')
  @UseGuards(AuthGuard, TenantGuard)
  @ApiBearerAuth('JWT-auth')
  export class CustomersController {
    constructor(private readonly customersService: CustomersService) {}
  
    @Get('companies')
    @ApiOperation({ summary: 'Search customer companies (tenant-scoped)' })
    @ApiQuery({ name: 'search', required: false, description: 'Search by company name' })
    @ApiQuery({ name: 'limit', required: false, description: 'Max results (default 20, max 100)' })
    async listCompanies(
      @Request() req: any,
      @Query() query: ListCompaniesQueryDto,
    ): Promise<CustomerCompanyDto[]> {
      const tenantId = req.tenant.tenantId;
      return this.customersService.searchCompanies(tenantId, query);
    }
  
    @Get('companies/:companyId/contacts')
    @ApiOperation({ summary: 'List/search contacts for a company (tenant-safe)' })
    @ApiQuery({ name: 'search', required: false, description: 'Search by contact name/email' })
    @ApiQuery({ name: 'limit', required: false, description: 'Max results (default 20, max 100)' })
    async listContacts(
      @Request() req: any,
      @Param('companyId') companyId: string,
      @Query() query: ListContactsQueryDto,
    ): Promise<CustomerContactDto[]> {
      const tenantId = req.tenant.tenantId;
      return this.customersService.listContacts(tenantId, companyId, query);
    }
  }
  