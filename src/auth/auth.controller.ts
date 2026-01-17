import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { AuthGuard } from './guards/auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipStatus } from '@prisma/client';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    // Use public anon key for user authentication (not service role)
    const supabaseUrl =
      this.configService.get<string>('SUPABASE_PROJECT_URL') ||
      this.configService.get<string>('SUPABASE_URL') ||
      '';
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new UnauthorizedException('Supabase configuration is missing. SUPABASE_ANON_KEY is required for login.');
    }

    // Create a public client for user authentication
    const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    // Authenticate with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Find or create user in our database
    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      update: {},
      create: {
        email: dto.email,
        name: null,
      },
    });

    // Get the user's first active tenant membership (if any)
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        userId: user.id,
        status: MembershipStatus.Active,
      },
      include: {
        tenant: true,
      },
    });

    return {
      accessToken: data.session.access_token,
      user: {
        id: user.id,
        email: user.email,
        role: membership?.role || null,
        tenantId: membership?.tenantId || undefined,
      },
    };
  }

  @Get('me')
  @UseGuards(AuthGuard, TenantGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user and tenant information' })
  async getMe(@Request() req: any) {
    return {
      user: req.user,
      tenant: req.tenant,
    };
  }
}
