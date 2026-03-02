import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { Role } from '@prisma/client';

import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard, Roles } from '../auth/guards/role.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CustomersService } from './customers.service';
import {
  CreateCustomerCompanyDto,
  CreateCustomerCompanyUserDto,
  CreateCustomerContactDto,
  CustomerCompanyDto,
  CustomerCompanyUserDto,
  CustomerContactDto,
  ListCompaniesQueryDto,
  ListContactsQueryDto,
} from './dto/customers.dto';

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

  @Post('companies')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: 'Create a customer company (Admin/Ops/Finance only)' })
  async createCompany(
    @Request() req: any,
    @Body() dto: CreateCustomerCompanyDto,
  ): Promise<CustomerCompanyDto> {
    const tenantId = req.tenant.tenantId;
    return this.customersService.createCompany(tenantId, dto.name);
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

  @Post('companies/:companyId/contacts')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({
    summary: 'Create/upsert a contact under a customer company (Admin/Ops/Finance only)',
  })
  async createContact(
    @Request() req: any,
    @Param('companyId') companyId: string,
    @Body() dto: CreateCustomerContactDto,
  ): Promise<CustomerContactDto> {
    const tenantId = req.tenant.tenantId;
    return this.customersService.createContact(tenantId, companyId, dto);
  }

  @Get('companies/:companyId/users')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({
    summary: 'List portal users linked to a customer company (Admin/Ops/Finance only)',
  })
  async listCompanyUsers(
    @Request() req: any,
    @Param('companyId') companyId: string,
  ): Promise<CustomerCompanyUserDto[]> {
    const tenantId = req.tenant.tenantId;
    return this.customersService.listCompanyUsers(tenantId, companyId);
  }

  @Post('companies/:companyId/users')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({
    summary: 'Create/invite a portal user linked to a customer company (Admin/Ops/Finance only)',
  })
  async createCompanyUser(
    @Request() req: any,
    @Param('companyId') companyId: string,
    @Body() dto: CreateCustomerCompanyUserDto,
  ): Promise<CustomerCompanyUserDto> {
    const tenantId = req.tenant.tenantId;
    return this.customersService.createCompanyUser(tenantId, companyId, dto);
  }
}