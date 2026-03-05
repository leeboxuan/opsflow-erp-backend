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
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import {
  TransportService,
  CreateOrdersBatchResult,
} from "./transport.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CreateOrdersBatchDto } from "./dto/create-orders-batch.dto";
import { ListOrdersQueryDto } from "./dto/list-orders-query.dto";
import { OrderDto } from "./dto/order.dto";
import { TripDto } from "./dto/trip.dto";
import { RoleGuard, Roles } from "@/auth/guards/role.guard";
import { Role } from "@prisma/client";
import { UpdateOrderDto } from "./dto/update-order.dto";

import { ReplaceOrderItemsDto } from "./dto/replace-order-items.dto";
import { UpdateDoDto } from "./dto/update-do.dto";

@ApiTags("transport")
@Controller("transport/orders")
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth("JWT-auth")
export class TransportController {
  constructor(private readonly transportService: TransportService) {}
  private flattenValidationErrors(errors: any[], parentPath = ""): string[] {
    const out: string[] = [];
  
    for (const err of errors) {
      const path = parentPath ? `${parentPath}.${err.property}` : err.property;
  
      if (err.constraints) {
        for (const msg of Object.values(err.constraints)) {
          out.push(`${path}: ${msg}`);
        }
      }
  
      if (Array.isArray(err.children) && err.children.length) {
        out.push(...this.flattenValidationErrors(err.children, path));
      }
    }
  
    return out;
  }
  
  private async validateRequestBody<T extends object>(cls: new () => T, body: any): Promise<T> {
    const instance = plainToInstance(cls, body);
    const errors = await validate(instance as any, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
  
    if (errors.length) {
      const messages = this.flattenValidationErrors(errors);
      // This is what you want to see in Render logs:
      console.error("[VALIDATION]", messages);
      throw new BadRequestException(messages);
    }
  
    return instance;
  }


  @Post()
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS)
  async createOrder(
    @Request() req: any,
    @Body() body: any,
  ): Promise<OrderDto | CreateOrdersBatchResult> {
    const tenantId = req.tenant.tenantId;

    // If request body contains "orders", treat as batch.
    if (body && Object.prototype.hasOwnProperty.call(body, "orders")) {
      const batch = await this.validateRequestBody(CreateOrdersBatchDto, body);
      return this.transportService.createOrder(tenantId, { orders: batch.orders });
    }

    // Backward compatible: single DTO payload
    const dto = await this.validateRequestBody(CreateOrderDto, body);
    return this.transportService.createOrder(tenantId, dto);
  }

  @Get()
  async listOrders(
    @Request() req: any,
    @Query() query: ListOrdersQueryDto,
  ): Promise<{ data: OrderDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    const customerCompanyId =
      req.tenant.role === Role.CUSTOMER
        ? req.tenant.customerCompanyId
        : undefined;
    return this.transportService.listOrders(tenantId, query, customerCompanyId);
  }

  @Get("next-internal-ref")
  async nextInternalRef(
    @Request() req: any,
    @Query("year") year?: string,
    @Query("month") month?: string,
  ) {
    const tenantId = req.tenant.tenantId;

    return this.transportService.getNextInternalRef(
      tenantId,
      year ? Number(year) : undefined,
      month ? Number(month) : undefined,
    );
  }
  
  @Get(":id")
  async getOrder(
    @Request() req: any,
    @Param("id") id: string,
  ): Promise<OrderDto> {
    const tenantId = req.tenant.tenantId;
    const customerCompanyId =
      req.tenant.role === Role.CUSTOMER
        ? req.tenant.customerCompanyId
        : undefined;
    const order = await this.transportService.getOrderById(
      tenantId,
      id,
      customerCompanyId,
    );

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    return order;
  }

  @Post(":orderId/plan-trip")
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS)
  async planTrip(
    @Request() req: any,
    @Param("orderId") orderId: string,
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
    @Body() dto: UpdateOrderDto,
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
    @Body() dto: UpdateDoDto,
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
    @Body() dto: ReplaceOrderItemsDto,
  ): Promise<OrderDto> {
    const tenantId = req.tenant.tenantId;
    return this.transportService.replaceOrderItems(tenantId, id, dto);
  }
  // (keep your existing imports)

  @Delete(":orderId")
  deleteOrder(@Req() req: any, @Param("orderId") orderId: string) {
    const tenantId = req.tenant.tenantId;
    return this.transportService.deleteOrder(tenantId, orderId);
  }

  @Get(":id/live")
  async getOrderLive(@Request() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    return this.transportService.getOrderLive(tenantId, id);
  }

  

}
