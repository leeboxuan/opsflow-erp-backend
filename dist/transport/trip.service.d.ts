import { PrismaService } from '../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripDto } from './dto/trip.dto';
import { EventLogService } from './event-log.service';
import { AssignVehicleDto } from '../driver/dto/assign-vehicle.dto';
export declare class TripService {
    private readonly prisma;
    private readonly eventLogService;
    constructor(prisma: PrismaService, eventLogService: EventLogService);
    createTrip(tenantId: string, dto: CreateTripDto): Promise<TripDto>;
    listTrips(tenantId: string, cursor?: string, limit?: number): Promise<{
        trips: TripDto[];
        nextCursor?: string;
    }>;
    getTripById(tenantId: string, id: string): Promise<TripDto | null>;
    private toDto;
    private stopToDto;
    private podToDto;
    transitionStatus(tenantId: string, tripId: string, newStatus: string): Promise<TripDto>;
    getTripEvents(tenantId: string, tripId: string): Promise<{
        tripId: string;
        events: {
            id: string;
            eventType: string;
            payload: import("@prisma/client/runtime/library").JsonValue;
            createdAt: Date;
        }[];
    }>;
    listTripsForDriver(tenantId: string, driverUserId: string, cursor?: string, limit?: number): Promise<{
        trips: TripDto[];
        nextCursor?: string;
    }>;
    assignDriver(tenantId: string, tripId: string, driverUserId: string): Promise<TripDto>;
    assignVehicle(tenantId: string, tripId: string, dto: AssignVehicleDto): Promise<TripDto>;
}
