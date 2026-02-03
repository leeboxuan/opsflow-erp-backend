import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { PrismaService } from '../prisma/prisma.service';
export declare class AuthController {
    private readonly authService;
    private readonly supabaseService;
    private readonly prisma;
    private readonly configService;
    constructor(authService: AuthService, supabaseService: SupabaseService, prisma: PrismaService, configService: ConfigService);
    login(dto: LoginDto): Promise<LoginResponseDto>;
    getMe(req: any): Promise<{
        id: string;
        email: string;
        role: any;
        tenantId: any;
        memberships: {
            tenantId: string;
            role: import("@prisma/client").$Enums.Role;
            status: import("@prisma/client").$Enums.MembershipStatus;
            tenant: {
                id: string;
                name: string;
            };
        }[];
    }>;
}
