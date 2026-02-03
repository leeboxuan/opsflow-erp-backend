"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransportModule = void 0;
const common_1 = require("@nestjs/common");
const transport_controller_1 = require("./transport.controller");
const transport_service_1 = require("./transport.service");
const trip_controller_1 = require("./trip.controller");
const trip_service_1 = require("./trip.service");
const pod_controller_1 = require("./pod.controller");
const pod_service_1 = require("./pod.service");
const stop_service_1 = require("./stop.service");
const event_log_service_1 = require("./event-log.service");
const prisma_module_1 = require("../prisma/prisma.module");
const auth_module_1 = require("../auth/auth.module");
let TransportModule = class TransportModule {
};
exports.TransportModule = TransportModule;
exports.TransportModule = TransportModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, auth_module_1.AuthModule],
        controllers: [transport_controller_1.TransportController, trip_controller_1.TripController, pod_controller_1.PodController],
        providers: [
            transport_service_1.TransportService,
            trip_service_1.TripService,
            pod_service_1.PodService,
            stop_service_1.StopService,
            event_log_service_1.EventLogService,
        ],
        exports: [trip_service_1.TripService, event_log_service_1.EventLogService],
    })
], TransportModule);
//# sourceMappingURL=transport.module.js.map