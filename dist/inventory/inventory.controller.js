"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const inventory_service_1 = require("./inventory.service");
const create_batch_dto_1 = require("./dto/create-batch.dto");
const receive_stock_dto_1 = require("./dto/receive-stock.dto");
const reserve_items_dto_1 = require("./dto/reserve-items.dto");
const dispatch_items_dto_1 = require("./dto/dispatch-items.dto");
const deliver_items_dto_1 = require("./dto/deliver-items.dto");
const client_1 = require("@prisma/client");
let InventoryController = class InventoryController {
    constructor(inventoryService) {
        this.inventoryService = inventoryService;
    }
    async getItemsSummary(req, search) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.getItemsSummary(tenantId, search);
    }
    async getItems(req, search) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.searchItems(tenantId, search);
    }
    async createBatch(req, dto) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.createBatch(tenantId, dto);
    }
    async receiveStock(req, batchId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.receiveStock(tenantId, batchId, dto);
    }
    async getBatchSummary(req, batchId) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.getBatchSummary(tenantId, batchId);
    }
    async listBatches(req, customerName, status) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.listBatches(tenantId, customerName, status);
    }
    async getBatch(req, batchId) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.getBatchById(tenantId, batchId);
    }
    async reserveItems(req, orderId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.reserveItems(tenantId, orderId, dto);
    }
    async dispatchItems(req, orderId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.dispatchItems(tenantId, orderId, dto);
    }
    async deliverItems(req, orderId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.deliverItems(tenantId, orderId, dto);
    }
    async cancelReservation(req, orderId) {
        const tenantId = req.tenant.tenantId;
        return this.inventoryService.cancelReservation(tenantId, orderId);
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)('items/summary'),
    (0, swagger_1.ApiOperation)({ summary: 'Get inventory items with unit counts by status' }),
    (0, swagger_1.ApiQuery)({ name: 'search', required: false, description: 'Search term for SKU, name, or reference' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('search')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "getItemsSummary", null);
__decorate([
    (0, common_1.Get)('items'),
    (0, swagger_1.ApiOperation)({ summary: 'Search inventory items' }),
    (0, swagger_1.ApiQuery)({ name: 'search', required: false, description: 'Search term for SKU, name, or reference' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('search')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "getItems", null);
__decorate([
    (0, common_1.Post)('batches'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new inventory batch' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_batch_dto_1.CreateBatchDto]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "createBatch", null);
__decorate([
    (0, common_1.Post)('batches/:batchId/receive'),
    (0, swagger_1.ApiOperation)({ summary: 'Stock In: receive items into a batch, create batch_items + inventory_units' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('batchId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, receive_stock_dto_1.ReceiveStockDto]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "receiveStock", null);
__decorate([
    (0, common_1.Get)('batches/:batchId/summary'),
    (0, swagger_1.ApiOperation)({ summary: 'Get batch summary with per-item counts by status' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('batchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "getBatchSummary", null);
__decorate([
    (0, common_1.Get)('batches'),
    (0, swagger_1.ApiOperation)({ summary: 'List inventory batches' }),
    (0, swagger_1.ApiQuery)({ name: 'customerName', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, enum: client_1.InventoryBatchStatus }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('customerName')),
    __param(2, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "listBatches", null);
__decorate([
    (0, common_1.Get)('batches/:batchId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get batch by ID' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('batchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "getBatch", null);
__decorate([
    (0, common_1.Post)('orders/:orderId/reserve'),
    (0, swagger_1.ApiOperation)({ summary: 'Reserve inventory units for an order' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('orderId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, reserve_items_dto_1.ReserveItemsDto]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "reserveItems", null);
__decorate([
    (0, common_1.Post)('orders/:orderId/dispatch'),
    (0, swagger_1.ApiOperation)({ summary: 'Dispatch reserved units (mark as InTransit)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('orderId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, dispatch_items_dto_1.DispatchItemsDto]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "dispatchItems", null);
__decorate([
    (0, common_1.Post)('orders/:orderId/deliver'),
    (0, swagger_1.ApiOperation)({ summary: 'Mark units as delivered' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('orderId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, deliver_items_dto_1.DeliverItemsDto]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "deliverItems", null);
__decorate([
    (0, common_1.Post)('orders/:orderId/cancel'),
    (0, swagger_1.ApiOperation)({ summary: 'Cancel reservation and release units' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "cancelReservation", null);
exports.InventoryController = InventoryController = __decorate([
    (0, swagger_1.ApiTags)('inventory'),
    (0, common_1.Controller)('inventory'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    __metadata("design:paramtypes", [inventory_service_1.InventoryService])
], InventoryController);
//# sourceMappingURL=inventory.controller.js.map