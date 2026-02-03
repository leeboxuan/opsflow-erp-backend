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
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
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
        const user = await this.prisma.user.upsert({
            where: { email: dto.email },
            update: {},
            create: {
                email: dto.email,
                name: null,
            },
        });
        const membership = await this.prisma.tenantMembership.findFirst({
            where: {
                userId: user.id,
                status: client_1.MembershipStatus.Active,
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
    async getMe(req) {
        const userId = req.user.userId;
        const currentTenantId = req.tenant.tenantId;
        const currentRole = req.tenant.role;
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw new common_1.UnauthorizedException('User not found');
        }
        const memberships = await this.prisma.tenantMembership.findMany({
            where: {
                userId,
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
        const membershipsSummary = memberships.map((membership) => ({
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
            role: currentRole,
            tenantId: currentTenantId,
            memberships: membershipsSummary,
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