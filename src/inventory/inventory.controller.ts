import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  Delete,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { InventoryService } from './inventory.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { ReserveItemsDto } from './dto/reserve-items.dto';
import { DispatchItemsDto } from './dto/dispatch-items.dto';
import { DeliverItemsDto } from './dto/deliver-items.dto';
import { BatchDto } from './dto/batch.dto';
import { InventoryItemDto } from './dto/inventory-item.dto';
import { ReleaseUnitsDto } from './dto/release-units.dto';
import { StockInDto } from './dto/stock-in.dto';
import { SearchUnitsQueryDto } from './dto/search-units-query.dto';
import { Patch } from '@nestjs/common';
import { RoleGuard, Roles } from '../auth/guards/role.guard';
import { UpdateUnitStatusDto } from './dto/update-unit-status.dto';
import { SearchUnitsResponseDto } from './dto/search-units-response.dto';
import { Role } from '@prisma/client';

/** Allowed batch status filter (matches Prisma InventoryBatchStatus) */
const BATCH_STATUS_VALUES = ['Draft', 'Open', 'Completed', 'Cancelled'] as const;
type BatchStatusQuery = (typeof BATCH_STATUS_VALUES)[number];

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth('JWT-auth')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) { }

  @Get('items/summary')
  @ApiOperation({ summary: 'Get inventory items with unit counts by status' })
  @ApiQuery({ name: 'search', required: false, description: 'Search term for SKU, name, or reference' })
  async getItemsSummary(
    @Request() req: any,
    @Query('search') search?: string,
  ): Promise<
    Array<{
      id: string;
      sku: string;
      name: string;
      reference: string | null;
      counts: {
        available: number;
        reserved: number;
        inTransit: number;
        delivered: number;
        total: number;
      };
    }>
  > {
    const tenantId = req.tenant.tenantId;
    const customerCompanyId =
  req.tenant.role === "CUSTOMER" ? req.tenant.customerCompanyId : undefined;
    return this.inventoryService.getItemsSummary(tenantId, search, customerCompanyId);
  }

  @Get('items')
  @ApiOperation({ summary: 'Search inventory items' })
  @ApiQuery({ name: 'search', required: false, description: 'Search term for SKU, name, or reference' })
  async getItems(
    @Request() req: any,
    @Query('search') search?: string,
  ): Promise<InventoryItemDto[]> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.searchItems(tenantId, search);
  }

  @Post('batches')
  @UseGuards(RoleGuard)
  @Roles(Role.ADMIN, Role.OPS)
  @ApiOperation({ summary: 'Create a new inventory batch' })
  async createBatch(
    @Request() req: any,
    @Body() dto: CreateBatchDto,
  ): Promise<BatchDto> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.createBatch(tenantId, dto);
  }

  @Post('batches/:batchId/receive')
  @ApiOperation({ summary: 'Stock In: receive items into a batch, create batch_items + inventory_units' })
  async receiveStock(
    @Request() req: any,
    @Param('batchId') batchId: string,
    @Body() dto: ReceiveStockDto,
  ): Promise<{
    items: Array<{
      inventoryItemId: string;
      sku: string;
      name: string;
      receivedQty: number;
      totalInBatch: number;
    }>;
    totalUnitsCreated: number;
  }> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.receiveStock(tenantId, batchId, dto);
  }

  @Get('batches/:batchId/summary')
  @ApiOperation({ summary: 'Get batch summary with per-item counts by status' })
  async getBatchSummary(
    @Request() req: any,
    @Param('batchId') batchId: string,
  ): Promise<{
    id: string;
    containerNumber: string;
    status: string;
    items: Array<{
      inventoryItemId: string;
      sku: string;
      name: string;
      counts: {
        available: number;
        reserved: number;
        inTransit: number;
        delivered: number;
        total: number;
      };
    }>;
  }> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.getBatchSummary(tenantId, batchId);
  }

  @Get('batches')
  @ApiOperation({ summary: 'List inventory batches' })
  @ApiQuery({ name: 'customerName', required: false })
  @ApiQuery({ name: 'status', required: false, enum: BATCH_STATUS_VALUES })
  async listBatches(
    @Request() req: any,
    @Query('customerName') customerName?: string,
    @Query('status') status?: BatchStatusQuery,
  ): Promise<BatchDto[]> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.listBatches(tenantId, customerName, status);
  }

  @Get('batches/:batchId')
  @ApiOperation({ summary: 'Get batch by ID' })
  async getBatch(
    @Request() req: any,
    @Param('batchId') batchId: string,
  ): Promise<BatchDto> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.getBatchById(tenantId, batchId);
  }

  @Post('orders/:orderId/reserve')
  @ApiOperation({ summary: 'Reserve inventory units for an order' })
  async reserveItems(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: ReserveItemsDto,
  ): Promise<{ reserved: number; items: Array<{ inventorySku: string; qty: number; unitSkus: string[] }> }> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.reserveItems(tenantId, orderId, dto);
  }

  @Post('orders/:orderId/dispatch')
  @ApiOperation({ summary: 'Dispatch reserved units (mark as InTransit)' })
  async dispatchItems(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: DispatchItemsDto,
  ): Promise<{ dispatched: number }> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.dispatchItems(tenantId, orderId, dto);
  }

  @Post('orders/:orderId/deliver')
  @ApiOperation({ summary: 'Mark units as delivered' })
  async deliverItems(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: DeliverItemsDto,
  ): Promise<{ delivered: number }> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.deliverItems(tenantId, orderId, dto);
  }

  @Post('orders/:orderId/cancel')
  @ApiOperation({ summary: 'Cancel reservation and release units' })
  async cancelReservation(
    @Request() req: any,
    @Param('orderId') orderId: string,
  ): Promise<{ released: number }> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.cancelReservation(tenantId, orderId);
  }

  @Post('orders/:orderId/release-units')
  async releaseUnits(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: ReleaseUnitsDto,
  ): Promise<{ released: number }> {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.releaseUnits(tenantId, orderId, dto);
  }

  @Get('units')
  async listUnits(
    @Request() req: any,
    @Query('inventoryItemId') inventoryItemId: string,
    @Query('status') status: string = 'Available',
    @Query('limit') limit: string = '50',
  ) {
    if (!inventoryItemId) {
      throw new BadRequestException('inventoryItemId is required. Use /inventory/units/search for ops register.');
    }
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.listUnits(tenantId, inventoryItemId, status, Number(limit));
  }

  @Get('units/search')
  @ApiOperation({ summary: 'Search inventory units (ops unit register) - cursor paginated' })
  @ApiQuery({ name: 'prefix', required: false, description: 'unitSku startsWith' })
  @ApiQuery({ name: 'search', required: false, description: 'contains match on unitSku / item sku / item name / batch code' })
  @ApiQuery({ name: 'itemSku', required: false, description: 'filter by item SKU (inventory_items.sku)' })
  @ApiQuery({ name: 'status', required: false, description: 'filter by unit status' })
  @ApiQuery({ name: 'batchId', required: false })
  @ApiQuery({ name: 'transportOrderId', required: false })
  @ApiQuery({ name: 'cursor', required: false, description: 'cursor (inventory_units.id) from previous page' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ type: SearchUnitsResponseDto })

  async searchUnits(
    @Request() req: any,
    @Query() query: SearchUnitsQueryDto,
  ): Promise<{
    rows: Array<{
      id: string;
      unitSku: string;
      status: string;
      inventoryItemId: string;
      itemSku: string;
      itemName: string | null;
      batchId: string;
      containerNumber: string | null;
      transportOrderId: string | null;
      tripId: string | null;
      stopId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number;
    stats: {
      total: number;
      available: number;
      reserved: number;
      inTransit: number;
      delivered: number;
      other: number;
    };
  }> {
    const tenantId = req.tenant.tenantId;
    const customerCompanyId =
      req.tenant.role === "CUSTOMER" ? req.tenant.customerCompanyId : undefined;
    const result = await this.inventoryService.searchUnits(tenantId, query, customerCompanyId);
    // Ensure the structure matches the expected return type
    if (Array.isArray(result)) {
      const rows = result;
      const stats = rows.reduce(
        (acc, row) => {
          acc.total += 1;
          const s = row.status;
          if (s === 'Available') acc.available += 1;
          else if (s === 'Reserved') acc.reserved += 1;
          else if (s === 'InTransit') acc.inTransit += 1;
          else if (s === 'Delivered') acc.delivered += 1;
          else acc.other += 1;
          return acc;
        },
        { total: 0, available: 0, reserved: 0, inTransit: 0, delivered: 0, other: 0 },
      );
      return {
        rows,
        nextCursor: null,
        hasMore: false,
        totalCount: rows.length,
        stats,
      };
    }

    return result;
  }

  @Post('stock-in')
  @ApiOperation({ summary: 'Create a batch + receive units from a client item sheet' })
  async stockIn(@Request() req: any, @Body() dto: StockInDto) {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.stockInFromClientSheet(tenantId, dto);
  }

  @Patch('units/:unitId/status')
  @UseGuards(RoleGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Admin: update inventory unit status' })
  async updateUnitStatus(
    @Request() req: any,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitStatusDto,
  ) {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.updateUnitStatus(tenantId, unitId, dto.status);
  }

  @Delete("items/:itemId")
  deleteInventoryItem(@Req() req, @Param("itemId") itemId: string) {
    const tenantId = req.tenant.tenantId;
    return this.inventoryService.deleteItem(tenantId, itemId);
  }

}

