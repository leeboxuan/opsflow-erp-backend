import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../transport/event-log.service';
import { DriverTripDto, DriverStopDto, DriverWalletDto } from './dto/driver-trip.dto';
import { AcceptTripDto } from './dto/accept-trip.dto';
import { CompleteStopDto } from './dto/complete-stop.dto';
export declare class DriverMvpService {
    private readonly prisma;
    private readonly eventLogService;
    constructor(prisma: PrismaService, eventLogService: EventLogService);
    getTripsByDate(tenantId: string, driverUserId: string, date: string): Promise<{
        trips: DriverTripDto[];
    }>;
    private computeLockState;
    private toDriverStopDto;
    acceptTrip(tenantId: string, driverUserId: string, tripId: string, dto: AcceptTripDto): Promise<DriverTripDto>;
    startTrip(tenantId: string, driverUserId: string, tripId: string): Promise<DriverTripDto>;
    startStop(tenantId: string, driverUserId: string, stopId: string): Promise<DriverStopDto>;
    completeStop(tenantId: string, driverUserId: string, stopId: string, dto: CompleteStopDto): Promise<DriverStopDto>;
    getWallet(tenantId: string, driverUserId: string, month: string): Promise<DriverWalletDto>;
}
