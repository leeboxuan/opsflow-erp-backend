import { PrismaService } from '../prisma/prisma.service';
import { LocationService } from '../driver/location.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { DriverDto } from './dto/driver.dto';
import { VehicleDto } from './dto/vehicle.dto';
import { DriverLocationDto } from '../driver/dto/location.dto';
export declare class AdminController {
    private readonly prisma;
    private readonly locationService;
    constructor(prisma: PrismaService, locationService: LocationService);
    getDrivers(req: any): Promise<DriverDto[]>;
    createDriver(req: any, dto: CreateDriverDto): Promise<DriverDto>;
    getVehicles(req: any): Promise<VehicleDto[]>;
    createVehicle(req: any, dto: CreateVehicleDto): Promise<VehicleDto>;
    getLocations(req: any): Promise<DriverLocationDto[]>;
}
