import { Role } from '@prisma/client';
export declare class LoginResponseDto {
    accessToken: string;
    user: {
        id: string;
        email: string;
        role: Role;
        tenantId?: string;
    };
}
