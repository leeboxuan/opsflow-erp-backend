import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { PrismaService } from '../prisma/prisma.service';
export declare class AuthController {
    private readonly authService;
    private readonly supabaseService;
    private readonly prisma;
    private readonly configService;
    constructor(authService: AuthService, supabaseService: SupabaseService, prisma: PrismaService, configService: ConfigService);
    login(dto: LoginDto): Promise<LoginResponseDto>;
    refresh(dto: RefreshTokenDto): Promise<RefreshResponseDto>;
    getMe(req: any): Promise<{
        id: any;
        email: any;
        role: any;
        authUserId: any;
        tenantMemberships: any;
    }>;
}
