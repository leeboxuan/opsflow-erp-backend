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
exports.CompleteStopDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CompleteStopDto {
}
exports.CompleteStopDto = CompleteStopDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: ['uploads/pod/stop-123/photo1.jpg', 'uploads/pod/stop-123/photo2.jpg'],
        description: 'At least one POD photo key required',
        minItems: 1,
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1, { message: 'At least one POD photo key is required' }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CompleteStopDto.prototype, "podPhotoKeys", void 0);
//# sourceMappingURL=complete-stop.dto.js.map