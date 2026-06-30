import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }

  @Get('tenant')
  @UseGuards(AuthGuard, TenantGuard)
  tenantHealth(@Request() req: any) {
    return {
      ok: true,
      tenantId: req.tenant.tenantId,
      role: req.tenant.role,
    };
  }
}
