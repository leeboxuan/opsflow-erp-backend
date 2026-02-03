import { Role } from '@prisma/client';
export declare class DriverDto {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    role: Role;
    membershipId: string;
    createdAt: Date;
    updatedAt: Date;
}
