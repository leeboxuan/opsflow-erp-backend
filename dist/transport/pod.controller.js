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
exports.PodController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const pod_service_1 = require("./pod.service");
const stop_service_1 = require("./stop.service");
const create_pod_dto_1 = require("./dto/create-pod.dto");
const update_stop_dto_1 = require("./dto/update-stop.dto");
let PodController = class PodController {
    constructor(podService, stopService) {
        this.podService = podService;
        this.stopService = stopService;
    }
    async updateStop(req, stopId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.stopService.updateStop(tenantId, stopId, dto);
    }
    async createOrUpdatePod(req, stopId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.podService.createOrUpdatePod(tenantId, stopId, dto);
    }
};
exports.PodController = PodController;
__decorate([
    (0, common_1.Patch)(':stopId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update stop details' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('stopId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_stop_dto_1.UpdateStopDto]),
    __metadata("design:returntype", Promise)
], PodController.prototype, "updateStop", null);
__decorate([
    (0, common_1.Post)(':stopId/pod'),
    (0, swagger_1.ApiOperation)({ summary: 'Create or update POD for a stop' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('stopId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, create_pod_dto_1.CreatePodDto]),
    __metadata("design:returntype", Promise)
], PodController.prototype, "createOrUpdatePod", null);
exports.PodController = PodController = __decorate([
    (0, swagger_1.ApiTags)('transport'),
    (0, common_1.Controller)('transport/stops'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    __metadata("design:paramtypes", [pod_service_1.PodService,
        stop_service_1.StopService])
], PodController);
//# sourceMappingURL=pod.controller.js.map