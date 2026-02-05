"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const swagger_1 = require("@nestjs/swagger");
const supabase_js_1 = require("@supabase/supabase-js");
const auth_service_1 = require("./auth.service");
const supabase_service_1 = require("./supabase.service");
const auth_guard_1 = require("./guards/auth.guard");
const tenant_guard_1 = require("./guards/tenant.guard");
const login_dto_1 = require("./dto/login.dto");
const refresh_token_dto_1 = require("./dto/refresh-token.dto");
const prisma_service_1 = require("../prisma/prisma.service");
let AuthController = class AuthController {
    constructor(authService, supabaseService, prisma, configService) {
        this.authService = authService;
        this.supabaseService = supabaseService;
        this.prisma = prisma;
        this.configService = configService;
    }
    async login(dto) {
        const supabaseUrl = this.configService.get('SUPABASE_PROJECT_URL') ||
            this.configService.get('SUPABASE_URL') ||
            '';
        const supabaseAnonKey = this.configService.get('SUPABASE_ANON_KEY') || '';
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new common_1.UnauthorizedException('Supabase configuration is missing. SUPABASE_ANON_KEY is required for login.');
        }
        const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseAnonKey);
        const { data, error } = await supabase.auth.signInWithPassword({
            email: dto.email,
            password: dto.password,
        });
        if (error || !data.session) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        const accessToken = data.session.access_token;
        const refreshToken = data.session.refresh_token ?? '';
        const expiresAt = data.session.expires_at ?? 0;
        const authUser = await this.authService.verifyToken(accessToken);
        if (!authUser) {
            throw new common_1.UnauthorizedException('Unable to map authenticated user');
        }
        const membership = await this.prisma.tenantMembership.findFirst({
            where: {
                userId: authUser.userId,
                status: 'Active',
            },
            include: {
                tenant: true,
            },
        });
        const user = {
            id: authUser.userId,
            email: authUser.email,
            role: membership?.role ?? null,
            tenantId: membership?.tenantId ?? undefined,
        };
        return {
            accessToken,
            refreshToken,
            expiresAt,
            user,
        };
    }
    async refresh(dto) {
        const supabaseUrl = this.configService.get('SUPABASE_PROJECT_URL') ||
            this.configService.get('SUPABASE_URL') ||
            '';
        const supabaseAnonKey = this.configService.get('SUPABASE_ANON_KEY') || '';
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new common_1.UnauthorizedException('Supabase configuration is missing');
        }
        const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseAnonKey);
        const { data, error } = await supabase.auth.refreshSession({
            refresh_token: dto.refreshToken,
        });
        if (error) {
            throw new common_1.UnauthorizedException(error.message || 'Invalid or expired refresh token');
        }
        if (!data.session) {
            throw new common_1.UnauthorizedException('Session refresh failed');
        }
        return {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token ?? '',
            expiresAt: data.session.expires_at ?? 0,
        };
    }
    async getMe(req) {
        const authUserId = req.user.authUserId;
        if (!authUserId) {
            throw new common_1.UnauthorizedException('Missing auth user id');
        }
        let user = await this.prisma.user.findFirst({
            where: { authUserId },
        });
        if (!user) {
            const email = req.user.email;
            if (!email) {
                throw new common_1.UnauthorizedException('User not found');
            }
            user = await this.prisma.user.findFirst({
                where: { email },
            });
        }
        if (!user) {
            throw new common_1.UnauthorizedException('User not found');
        }
        const updates = {};
        if (!user.authUserId) {
            updates.authUserId = authUserId;
        }
        if (!user.role) {
            updates.role = 'USER';
        }
        if (Object.keys(updates).length > 0) {
            user = await this.prisma.user.update({
                where: { id: user.id },
                data: updates,
            });
        }
        const effectiveRole = user.role || 'USER';
        const memberships = await this.prisma.tenantMembership.findMany({
            where: {
                userId: user.id,
            },
            include: {
                tenant: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        const tenantMemberships = memberships.map((membership) => ({
            tenantId: membership.tenantId,
            role: membership.role,
            status: membership.status,
            tenant: {
                id: membership.tenant.id,
                name: membership.tenant.name,
            },
        }));
        return {
            id: user.id,
            email: user.email,
            role: effectiveRole,
            authUserId: user.authUserId,
            tenantMemberships,
        };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('login'),
    (0, swagger_1.ApiOperation)({ summary: 'Login with email and password' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, swagger_1.ApiOperation)({ summary: 'Refresh session using refresh token' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [refresh_token_dto_1.RefreshTokenDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    (0, swagger_1.ApiOperation)({ summary: 'Get current user and tenant information' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getMe", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('auth'),
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        supabase_service_1.SupabaseService,
        prisma_service_1.PrismaService,
        config_1.ConfigService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map