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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("@prisma/client");
class BatchDto {
}
exports.BatchDto = BatchDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], BatchDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], BatchDto.prototype, "batchCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, nullable: true }),
    __metadata("design:type", String)
], BatchDto.prototype, "customerName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, nullable: true }),
    __metadata("design:type", String)
], BatchDto.prototype, "customerRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, nullable: true }),
    __metadata("design:type", Date)
], BatchDto.prototype, "receivedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, nullable: true }),
    __metadata("design:type", String)
], BatchDto.prototype, "notes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: client_1.InventoryBatchStatus }),
    __metadata("design:type", String)
], BatchDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Date)
], BatchDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Date)
], BatchDto.prototype, "updatedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], BatchDto.prototype, "totalUnits", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], BatchDto.prototype, "availableUnits", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], BatchDto.prototype, "reservedUnits", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], BatchDto.prototype, "inTransitUnits", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], BatchDto.prototype, "deliveredUnits", void 0);
//# sourceMappingURL=batch.dto.js.map