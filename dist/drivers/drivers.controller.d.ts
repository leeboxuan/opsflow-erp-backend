import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { UpdateDriverDto } from './dto/update-driver.dto';
export interface DriverDto {
    id: string;
    email: string;
    name: string | null;
    role: Role;
    createdAt: Date;
    updatedAt: Date;
}
export declare class DriversController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getDriverMe(req: any): Promise<DriverDto>;
    updateDriverMe(req: any, dto: UpdateDriverDto): Promise<DriverDto>;
}
