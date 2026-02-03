import { PrismaService } from '../prisma/prisma.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationDto, DriverLocationDto } from './dto/location.dto';
export declare class LocationService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    upsertLocation(tenantId: string, driverUserId: string, dto: UpdateLocationDto): Promise<LocationDto>;
    getLatestLocation(tenantId: string, driverUserId: string): Promise<LocationDto | null>;
    getAllDriverLocations(tenantId: string): Promise<DriverLocationDto[]>;
    private toLocationDto;
    private toDriverLocationDto;
}
