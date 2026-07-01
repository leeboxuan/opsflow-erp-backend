import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role, WarehouseJobDocumentType } from '@prisma/client';
import { AuthGuard } from '../../shared/auth/guards/auth.guard';
import { TenantGuard } from '../../shared/auth/guards/tenant.guard';
import { RoleGuard, Roles } from '../../shared/auth/guards/role.guard';
import { WarehouseJobsService } from './warehouse-jobs.service';
import { WarehouseJobLinesService } from './warehouse-job-lines.service';
import { WarehouseJobUnitsService } from './warehouse-job-units.service';
import { WarehouseJobDocumentsService } from './warehouse-job-documents.service';
import { WarehouseJobReportPreviewService } from './warehouse-job-report-preview.service';
import { CreateWarehouseJobDto } from './dto/create-warehouse-job.dto';
import { UpdateWarehouseJobDto } from './dto/update-warehouse-job.dto';
import { ListWarehouseJobsQueryDto } from './dto/list-warehouse-jobs-query.dto';
import { CancelWarehouseJobDto } from './dto/cancel-warehouse-job.dto';
import { CreateWarehouseJobLineDto } from './dto/create-warehouse-job-line.dto';
import { UpdateWarehouseJobLineDto } from './dto/update-warehouse-job-line.dto';
import { LinkWarehouseJobUnitsDto } from './dto/link-warehouse-job-units.dto';
import { ConfirmWarehouseJobUnitsDto } from './dto/confirm-warehouse-job-units.dto';
import { ReleaseWarehouseJobUnitsDto } from './dto/release-warehouse-job-units.dto';
import { ListWarehouseJobUnitsQueryDto } from './dto/list-warehouse-job-units-query.dto';
import {
  RejectWarehouseJobDocumentDto,
  UpdateWarehouseJobDocumentDto,
} from './dto/warehouse-job-document.dto';
import { UpdateWarehouseJobExecutionDto } from './dto/update-warehouse-job-execution.dto';

const READ_ROLES = [Role.ADMIN, Role.OPS, Role.FINANCE, Role.WAREHOUSE];
const MUTATE_ROLES = [Role.ADMIN, Role.OPS];
const FLOOR_ROLES = [Role.ADMIN, Role.OPS, Role.WAREHOUSE];

@ApiTags('warehouse-jobs')
@Controller('warehouse-jobs')
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(...READ_ROLES)
@ApiBearerAuth('JWT-auth')
export class WarehouseJobsController {
  constructor(
    private readonly warehouseJobsService: WarehouseJobsService,
    private readonly warehouseJobLinesService: WarehouseJobLinesService,
    private readonly warehouseJobUnitsService: WarehouseJobUnitsService,
    private readonly warehouseJobDocumentsService: WarehouseJobDocumentsService,
    private readonly warehouseJobReportPreviewService: WarehouseJobReportPreviewService,
  ) {}

  @Post()
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Create a warehouse job header' })
  async create(@Request() req: any, @Body() dto: CreateWarehouseJobDto) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.create(tenantId, dto, actorUserId);
  }

  @Get()
  @ApiOperation({ summary: 'List warehouse jobs' })
  async list(
    @Request() req: any,
    @Query() query: ListWarehouseJobsQueryDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.list(tenantId, query, actorRole, actorUserId);
  }

  @Get(':id/report-preview')
  @ApiOperation({
    summary: 'Warehouse job report preview (data-only, no PDF generation)',
  })
  async reportPreview(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobReportPreviewService.getReportPreview(
      tenantId,
      { role: actorRole, userId: actorUserId },
      id,
    );
  }

  @Get(':id/documents')
  @ApiOperation({ summary: 'List warehouse job documents' })
  async listDocuments(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobDocumentsService.list(
      tenantId,
      id,
      actorRole,
      actorUserId,
    );
  }

  @Post(':id/documents')
  @Roles(...FLOOR_ROLES)
  @ApiOperation({ summary: 'Upload warehouse job document or photo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: Object.values(WarehouseJobDocumentType) },
        notes: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: WarehouseJobDocumentType,
    @Body('notes') notes?: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!type) throw new BadRequestException('type is required');
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobDocumentsService.upload(
      tenantId,
      id,
      type,
      file,
      actorRole,
      actorUserId,
      notes,
    );
  }

  @Patch(':id/documents/:documentId')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Update warehouse job document metadata' })
  async updateDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateWarehouseJobDocumentDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobDocumentsService.updateMetadata(
      tenantId,
      id,
      documentId,
      dto,
      actorUserId,
    );
  }

  @Delete(':id/documents/:documentId')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Delete warehouse job document' })
  async deleteDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobDocumentsService.delete(
      tenantId,
      id,
      documentId,
      actorUserId,
    );
  }

  @Post(':id/documents/:documentId/approve')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Approve warehouse job document' })
  async approveDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobDocumentsService.approve(
      tenantId,
      id,
      documentId,
      actorUserId,
    );
  }

  @Post(':id/documents/:documentId/reject')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Reject warehouse job document' })
  async rejectDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() dto: RejectWarehouseJobDocumentDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobDocumentsService.reject(
      tenantId,
      id,
      documentId,
      dto,
      actorUserId,
    );
  }

  @Patch(':id/execution')
  @Roles(...FLOOR_ROLES)
  @ApiOperation({ summary: 'Update warehouse job execution fields' })
  async updateExecution(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseJobExecutionDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.updateExecution(
      tenantId,
      id,
      dto,
      actorUserId,
      actorRole,
    );
  }

  @Get(':id/lines')
  @ApiOperation({ summary: 'List warehouse job lines' })
  async listLines(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    return this.warehouseJobLinesService.list(tenantId, id);
  }

  @Post(':id/lines')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Create a warehouse job line' })
  async createLine(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateWarehouseJobLineDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobLinesService.create(
      tenantId,
      id,
      dto,
      actorUserId,
    );
  }

  @Patch(':id/lines/:lineId')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Update a warehouse job line' })
  async updateLine(
    @Request() req: any,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateWarehouseJobLineDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobLinesService.update(
      tenantId,
      id,
      lineId,
      dto,
      actorUserId,
    );
  }

  @Delete(':id/lines/:lineId')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Delete a warehouse job line' })
  async deleteLine(
    @Request() req: any,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobLinesService.delete(
      tenantId,
      id,
      lineId,
      actorUserId,
    );
  }

  @Get(':id/units')
  @ApiOperation({ summary: 'List linked warehouse job units' })
  async listUnits(
    @Request() req: any,
    @Param('id') id: string,
    @Query() query: ListWarehouseJobUnitsQueryDto,
  ) {
    const tenantId = req.tenant.tenantId;
    return this.warehouseJobUnitsService.list(tenantId, id, query);
  }

  @Post(':id/lines/:lineId/units/confirm')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Confirm linked units for a warehouse job line' })
  async confirmLineUnits(
    @Request() req: any,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: ConfirmWarehouseJobUnitsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobUnitsService.confirmForLine(
      tenantId,
      id,
      lineId,
      dto,
      actorUserId,
    );
  }

  @Post(':id/lines/:lineId/units/release')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Release linked units for a warehouse job line' })
  async releaseLineUnits(
    @Request() req: any,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: ReleaseWarehouseJobUnitsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobUnitsService.releaseForLine(
      tenantId,
      id,
      lineId,
      dto,
      actorUserId,
    );
  }

  @Post(':id/lines/:lineId/units')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Link units to a warehouse job line' })
  async linkLineUnits(
    @Request() req: any,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: LinkWarehouseJobUnitsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobUnitsService.linkToLine(
      tenantId,
      id,
      lineId,
      dto,
      actorUserId,
    );
  }

  @Post(':id/units/confirm')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Confirm linked units for a warehouse job' })
  async confirmJobUnits(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ConfirmWarehouseJobUnitsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobUnitsService.confirmForJob(
      tenantId,
      id,
      dto,
      actorUserId,
    );
  }

  @Post(':id/units/release')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Release linked units for a warehouse job' })
  async releaseJobUnits(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReleaseWarehouseJobUnitsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobUnitsService.releaseForJob(
      tenantId,
      id,
      dto,
      actorUserId,
    );
  }

  @Post(':id/units')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Link units to a warehouse job header' })
  async linkJobUnits(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: LinkWarehouseJobUnitsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobUnitsService.linkToJob(
      tenantId,
      id,
      dto,
      actorUserId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get warehouse job detail' })
  async getById(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.getById(tenantId, id, actorRole, actorUserId);
  }

  @Patch(':id')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Update warehouse job header' })
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.update(tenantId, id, dto, actorUserId);
  }

  @Post(':id/open')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Transition warehouse job DRAFT -> OPEN' })
  async open(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.open(tenantId, id, actorUserId);
  }

  @Post(':id/start')
  @Roles(...FLOOR_ROLES)
  @ApiOperation({ summary: 'Transition warehouse job OPEN -> IN_PROGRESS' })
  async start(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.start(
      tenantId,
      id,
      actorUserId,
      actorRole,
    );
  }

  @Post(':id/complete')
  @Roles(...FLOOR_ROLES)
  @ApiOperation({ summary: 'Transition warehouse job IN_PROGRESS -> COMPLETED' })
  async complete(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.tenant.tenantId;
    const actorRole = req.tenant.role as Role;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.complete(
      tenantId,
      id,
      actorUserId,
      actorRole,
    );
  }

  @Post(':id/cancel')
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Cancel warehouse job' })
  async cancel(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CancelWarehouseJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const actorUserId = req.user?.userId as string | undefined;
    return this.warehouseJobsService.cancel(
      tenantId,
      id,
      actorUserId,
      dto.reason,
    );
  }
}
