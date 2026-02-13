import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  Get,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';

import { PodService } from './pod.service';
import { StopService } from './stop.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { UpdateStopDto } from './dto/update-stop.dto';
import { PodDto, StopDto } from './dto/trip.dto';

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

  // ✅ NEW: Upload a POD photo (multipart/form-data)
  // POST /transport/stops/:stopId/pod/photos?kind=pod|signature|damage
  @Post(':stopId/pod/photos')
  @ApiOperation({ summary: 'Upload POD photo to Supabase Storage and attach to pod.photoKeys' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPodPhoto(
    @Request() req: any,
    @Param('stopId') stopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kind?: string,
  ): Promise<{ key: string; signedUrl: string; expiresInSeconds: number }> {
    if (!file) throw new BadRequestException('Missing file (field name must be "file")');

    const tenantId = req.tenant.tenantId;
    return this.podService.uploadPodPhoto(tenantId, stopId, file, kind);
  }

  // ✅ NEW: Get signed URLs for all stored keys for a stop’s POD
  // GET /transport/stops/:stopId/pod/photos
  @Get(':stopId/pod/photos')
  @ApiOperation({ summary: 'Get signed URLs for POD photos (from pod.photoKeys)' })
  async listPodPhotoSignedUrls(
    @Request() req: any,
    @Param('stopId') stopId: string,
  ): Promise<{ items: { key: string; signedUrl: string }[]; expiresInSeconds: number }> {
    const tenantId = req.tenant.tenantId;
    return this.podService.getPodPhotoSignedUrls(tenantId, stopId);
  }
}
