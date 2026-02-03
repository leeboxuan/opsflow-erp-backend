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
exports.TransportController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const transport_service_1 = require("./transport.service");
const create_order_dto_1 = require("./dto/create-order.dto");
let TransportController = class TransportController {
    constructor(transportService) {
        this.transportService = transportService;
    }
    async createOrder(req, dto) {
        const tenantId = req.tenant.tenantId;
        return this.transportService.createOrder(tenantId, dto);
    }
    async listOrders(req, cursor, limit) {
        const tenantId = req.tenant.tenantId;
        const limitNum = limit ? parseInt(limit, 10) : 20;
        return this.transportService.listOrders(tenantId, cursor, limitNum);
    }
    async getOrder(req, id) {
        const tenantId = req.tenant.tenantId;
        const order = await this.transportService.getOrderById(tenantId, id);
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return order;
    }
    async planTrip(req, orderId) {
        const tenantId = req.tenant.tenantId;
        return this.transportService.planTripFromOrder(tenantId, orderId);
    }
};
exports.TransportController = TransportController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_order_dto_1.CreateOrderDto]),
    __metadata("design:returntype", Promise)
], TransportController.prototype, "createOrder", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('cursor')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], TransportController.prototype, "listOrders", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TransportController.prototype, "getOrder", null);
__decorate([
    (0, common_1.Post)(':orderId/plan-trip'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TransportController.prototype, "planTrip", null);
exports.TransportController = TransportController = __decorate([
    (0, swagger_1.ApiTags)('transport'),
    (0, common_1.Controller)('transport/orders'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    __metadata("design:paramtypes", [transport_service_1.TransportService])
], TransportController);
//# sourceMappingURL=transport.controller.js.map