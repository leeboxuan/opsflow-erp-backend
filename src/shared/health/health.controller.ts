import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { AccessSurface } from '../auth/guards/access-surface.guard';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }

  @Get('tenant')
  @UseGuards(AuthGuard, TenantGuard)
  @AccessSurface('member')
  tenantHealth(@Request() req: any) {
    return {
      ok: true,
      tenantId: req.tenant.tenantId,
      role: req.tenant.role,
    };
  }
}
