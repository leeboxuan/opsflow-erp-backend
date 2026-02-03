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
exports.PodService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const event_log_service_1 = require("./event-log.service");
let PodService = class PodService {
    constructor(prisma, eventLogService) {
        this.prisma = prisma;
        this.eventLogService = eventLogService;
    }
    async createOrUpdatePod(tenantId, stopId, dto) {
        const stop = await this.prisma.stop.findFirst({
            where: {
                id: stopId,
                tenantId,
            },
        });
        if (!stop) {
            throw new common_1.NotFoundException('Stop not found');
        }
        const existingPod = await this.prisma.pod.findFirst({
            where: {
                stopId,
                tenantId,
            },
        });
        let podStatus = dto.status;
        if (!podStatus) {
            if (dto.signatureUrl || dto.signedBy) {
                podStatus = 'Completed';
            }
            else {
                podStatus = 'Pending';
            }
        }
        const photoUrlValue = dto.photoUrl || dto.signatureUrl || null;
        const pod = existingPod
            ? await this.prisma.pod.update({
                where: {
                    id: existingPod.id,
                },
                data: {
                    status: podStatus,
                    signedBy: dto.signedBy || null,
                    signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
                    photoUrl: photoUrlValue,
                },
            })
            : await this.prisma.pod.create({
                data: {
                    tenantId,
                    stopId,
                    status: podStatus,
                    signedBy: dto.signedBy || null,
                    signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
                    photoUrl: photoUrlValue,
                },
            });
        await this.eventLogService.logEvent(tenantId, 'Stop', stopId, 'POD_UPDATED', {
            podId: pod.id,
            status: pod.status,
            signedBy: pod.signedBy,
            signatureUrl: dto.signatureUrl,
            note: dto.note,
        });
        return this.toDto(pod);
    }
    toDto(pod) {
        return {
            id: pod.id,
            status: pod.status,
            signedBy: pod.signedBy,
            signedAt: pod.signedAt,
            photoUrl: pod.photoUrl,
            createdAt: pod.createdAt,
            updatedAt: pod.updatedAt,
        };
    }
};
exports.PodService = PodService;
exports.PodService = PodService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_log_service_1.EventLogService])
], PodService);
//# sourceMappingURL=pod.service.js.map