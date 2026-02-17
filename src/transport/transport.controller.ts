import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  NotFoundException,
  Patch,
  Put,
  BadRequestException,
  Delete,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TransportService } from './transport.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderDto } from './dto/order.dto';
import { TripDto } from './dto/trip.dto';
import { RoleGuard, Roles } from '@/auth/guards/role.guard';
import { Role } from '@prisma/client';
import { UpdateOrderDto } from './dto/update-order.dto';

import { ReplaceOrderItemsDto } from "./dto/replace-order-items.dto";
import { UpdateDoDto } from "./dto/update-do.dto";

@ApiTags('transport')
@Controller('transport/orders')
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth('JWT-auth')
export class TransportController {
  constructor(private readonly transportService: TransportService) { }

  @Post()
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS)
  async createOrder(
    @Request() req: any,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderDto> {
    const tenantId = req.tenant.tenantId;
    return this.transportService.createOrder(tenantId, dto);
  }

  @Get()
  async listOrders(
    @Request() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ orders: OrderDto[]; nextCursor?: string }> {
    // Extract tenantId from request context (set by TenantGuard)
    // tenantId is REQUIRED - all roles must operate under a tenant
    const tenantId = req.tenant.tenantId;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const customerCompanyId =
    req.tenant.role === Role.CUSTOMER ? req.tenant.customerCompanyId : undefined;
    return this.transportService.listOrders(tenantId, cursor, limitNum, customerCompanyId);
  }

  @Get(':id')
  async getOrder(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<OrderDto> {
    const tenantId = req.tenant.tenantId;
    const customerCompanyId =
    req.tenant.role === Role.CUSTOMER ? req.tenant.customerCompanyId : undefined;
    const order = await this.transportService.getOrderById(tenantId, id, customerCompanyId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  @Post(':orderId/plan-trip')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS)
  async planTrip(
    @Request() req: any,
    @Param('orderId') orderId: string,
  ): Promise<TripDto> {
    const tenantId = req.tenant.tenantId;
    return this.transportService.planTripFromOrder(tenantId, orderId);
  }

  @Patch(":id")
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS)
  async updateOrder(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateOrderDto
  ): Promise<OrderDto> {
    const tenantId = req.tenant.tenantId;
    return this.transportService.updateOrderHeader(tenantId, id, dto);
  }

  @Patch(":id/do")
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS, Role.DRIVER)
  async updateDo(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateDoDto
  ): Promise<OrderDto> {
    const tenantId = req.tenant.tenantId;
    return this.transportService.updateOrderDo(tenantId, id, dto);
  }

  @Put(":id/items")
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS)
  async replaceOrderItems(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: ReplaceOrderItemsDto
  ): Promise<OrderDto> {
    const tenantId = req.tenant.tenantId;
    return this.transportService.replaceOrderItems(tenantId, id, dto);
  }
  // (keep your existing imports)

  @Delete("orders/:orderId")
  deleteOrder(@Req() req: any, @Param("orderId") orderId: string) {
    const tenantId = req.tenant.tenantId;
    return this.transportService.deleteOrder(tenantId, orderId);
  }

  @Get(':id/live')
  async getOrderLive(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    return this.transportService.getOrderLive(tenantId, id);
  }

  @Get("orders/next-internal-ref")
async nextInternalRef(@Request() req: any) {
  const tenantId = req.tenant.tenantId;
  return this.transportService.getNextInternalRef(tenantId);
}


}
