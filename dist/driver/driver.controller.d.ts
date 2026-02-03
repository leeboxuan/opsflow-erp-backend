import { TripService } from '../transport/trip.service';
import { PrismaService } from '../prisma/prisma.service';
import { LocationService } from './location.service';
import { DriverMvpService } from './driver-mvp.service';
import { AssignVehicleDto } from './dto/assign-vehicle.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationDto } from './dto/location.dto';
import { TripDto } from '../transport/dto/trip.dto';
import { DriverTripDto, DriverWalletDto } from './dto/driver-trip.dto';
import { AcceptTripDto } from './dto/accept-trip.dto';
import { CompleteStopDto } from './dto/complete-stop.dto';
export declare class DriverController {
    private readonly tripService;
    private readonly prisma;
    private readonly locationService;
    private readonly driverMvpService;
    constructor(tripService: TripService, prisma: PrismaService, locationService: LocationService, driverMvpService: DriverMvpService);
    getTripsByDate(req: any, date?: string): Promise<{
        trips: DriverTripDto[];
    }>;
    acceptTrip(req: any, tripId: string, dto: AcceptTripDto): Promise<DriverTripDto>;
    startTrip(req: any, tripId: string): Promise<DriverTripDto>;
    startStop(req: any, stopId: string): Promise<import("./dto/driver-trip.dto").DriverStopDto>;
    completeStop(req: any, stopId: string, dto: CompleteStopDto): Promise<import("./dto/driver-trip.dto").DriverStopDto>;
    getWallet(req: any, month: string): Promise<DriverWalletDto>;
    selectVehicle(req: any, tripId: string, dto: AssignVehicleDto): Promise<TripDto>;
    updateLocation(req: any, dto: UpdateLocationDto): Promise<LocationDto>;
    getMyLocation(req: any): Promise<LocationDto | {
        message: string;
    }>;
}
