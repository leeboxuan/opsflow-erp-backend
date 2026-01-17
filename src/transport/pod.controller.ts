import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PodService } from './pod.service';
import { StopService } from './stop.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { UpdateStopDto } from './dto/update-stop.dto';
import { PodDto } from './dto/trip.dto';
import { StopDto } from './dto/trip.dto';

@ApiTags('transport')
@Controller('transport/stops')
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth('JWT-auth')
export class PodController {
  constructor(
    private readonly podService: PodService,
    private readonly stopService: StopService,
  ) {}

  @Patch(':stopId')
  @ApiOperation({ summary: 'Update stop details' })
  async updateStop(
    @Request() req: any,
    @Param('stopId') stopId: string,
    @Body() dto: UpdateStopDto,
  ): Promise<StopDto> {
    const tenantId = req.tenant.tenantId;
    return this.stopService.updateStop(tenantId, stopId, dto);
  }

  @Post(':stopId/pod')
  @ApiOperation({ summary: 'Create or update POD for a stop' })
  async createOrUpdatePod(
    @Request() req: any,
    @Param('stopId') stopId: string,
    @Body() dto: CreatePodDto,
  ): Promise<PodDto> {
    const tenantId = req.tenant.tenantId;
    return this.podService.createOrUpdatePod(tenantId, stopId, dto);
  }
}
