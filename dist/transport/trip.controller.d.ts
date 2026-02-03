import { TripService } from './trip.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripDto } from './dto/trip.dto';
import { AssignDriverDto } from '../driver/dto/assign-driver.dto';
import { AssignVehicleDto } from '../driver/dto/assign-vehicle.dto';
export declare class TripController {
    private readonly tripService;
    constructor(tripService: TripService);
    createTrip(req: any, dto: CreateTripDto): Promise<TripDto>;
    listTrips(req: any, cursor?: string, limit?: string): Promise<{
        trips: TripDto[];
        nextCursor?: string;
    }>;
    getTrip(req: any, id: string): Promise<TripDto>;
    dispatchTrip(req: any, id: string): Promise<TripDto>;
    startTrip(req: any, id: string): Promise<TripDto>;
    completeTrip(req: any, id: string): Promise<TripDto>;
    getTripEvents(req: any, id: string): Promise<{
        tripId: string;
        events: {
            id: string;
            eventType: string;
            payload: import("@prisma/client/runtime/library").JsonValue;
            createdAt: Date;
        }[];
    }>;
    assignDriver(req: any, tripId: string, dto: AssignDriverDto): Promise<TripDto>;
    assignVehicle(req: any, tripId: string, dto: AssignVehicleDto): Promise<TripDto>;
}
