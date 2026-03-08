import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RoleGuard } from "../auth/guards/role.guard";
import { Roles } from "../auth/guards/role.guard";
import { Role } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";
import { CreateJobDto } from "./dto/create-job.dto";
import { UpdateJobDto } from "./dto/update-job.dto";
import { AssignJobDto } from "./dto/assign-job.dto";
import { CancelJobDto } from "./dto/cancel-job.dto";
import { JobListQueryDto } from "./dto/job-list-query.dto";
import { ImportConfirmRequestDto } from "./dto/import-job-row.dto";
import { LclImportConfirmRequestDto } from "./dto/lcl-import.dto";

@ApiTags("ops-jobs")
@Controller("jobs")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS)
@ApiBearerAuth("JWT-auth")
export class OpsJobsController {
  constructor(private readonly jobs: OpsJobsService) {}

  @Get()
  @ApiOperation({ summary: "List jobs with filters" })
  async list(@Req() req: any, @Query() query: JobListQueryDto) {
    const tenantId = req.tenant.tenantId;
    return this.jobs.list(tenantId, query);
  }

  @Post()
  @ApiOperation({ summary: "Create Draft job" })
  async create(@Req() req: any, @Body() dto: CreateJobDto) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.create(tenantId, dto, userId);
  }

  @Post("import/preview")
  @ApiOperation({ summary: "Preview Excel import: parse and validate rows, no DB writes" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } })
  @UseInterceptors(FileInterceptor("file"))
  async importPreview(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    const tenantId = req.tenant.tenantId;
    return this.jobs.importPreview(tenantId, file.buffer);
  }

  @Post("import/confirm")
  @ApiOperation({ summary: "Confirm import: create Draft jobs from validated rows" })
  async importConfirm(
    @Req() req: any,
    @Body() dto: ImportConfirmRequestDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.importConfirm(tenantId, dto.rows, userId);
  }

  @Post("import/lcl/preview")
  @ApiOperation({ summary: "LCL Order In: preview Excel (group by Order Ref), no DB writes" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "customerCompanyId", "pickupDate", "pickupAddress1"],
      properties: {
        file: { type: "string", format: "binary" },
        customerCompanyId: { type: "string" },
        pickupDate: { type: "string", example: "2025-03-10" },
        pickupAddress1: { type: "string" },
        pickupAddress2: { type: "string" },
        pickupPostal: { type: "string" },
        pickupContactName: { type: "string" },
        pickupContactPhone: { type: "string" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async lclImportPreview(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("file is required");
    const body = req.body as Record<string, string>;
    const customerCompanyId = body?.customerCompanyId?.trim();
    const pickupDate = body?.pickupDate?.trim();
    const pickupAddress1 = body?.pickupAddress1?.trim();
    if (!customerCompanyId || !pickupDate || !pickupAddress1) {
      throw new BadRequestException(
        "customerCompanyId, pickupDate, and pickupAddress1 are required",
      );
    }
    const tenantId = req.tenant.tenantId;
    return this.jobs.lclImportPreview(tenantId, file.buffer, {
      customerCompanyId,
      pickupDate,
      pickupAddress1,
      pickupAddress2: body?.pickupAddress2?.trim() || undefined,
      pickupPostal: body?.pickupPostal?.trim() || undefined,
      pickupContactName: body?.pickupContactName?.trim() || undefined,
      pickupContactPhone: body?.pickupContactPhone?.trim() || undefined,
    });
  }

  @Post("import/lcl/confirm")
  @ApiOperation({ summary: "LCL Order In: confirm import, create Draft jobs" })
  async lclImportConfirm(
    @Req() req: any,
    @Body() dto: LclImportConfirmRequestDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.lclImportConfirm(tenantId, dto, userId);
  }

  @Get(":jobId")
  @ApiOperation({ summary: "Get job by id" })
  async getOne(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    return this.jobs.getOne(tenantId, jobId);
  }

  @Patch(":jobId")
  @ApiOperation({ summary: "Update job (not if Completed/Cancelled)" })
  async update(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: UpdateJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.update(tenantId, jobId, dto, userId);
  }

  @Post(":jobId/assign")
  @ApiOperation({ summary: "Assign driver (and optional vehicle) to job" })
  async assign(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: AssignJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.assign(tenantId, jobId, dto, userId);
  }

  @Post(":jobId/cancel")
  @ApiOperation({ summary: "Cancel job with reason" })
  async cancel(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: CancelJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.cancel(tenantId, jobId, dto, userId);
  }

  @Delete(":jobId")
  @ApiOperation({ summary: "Delete job (only if Draft or unassigned Assigned)" })
  async delete(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    await this.jobs.delete(tenantId, jobId, userId);
  }

  @Post(":jobId/verify-depot")
  @ApiOperation({ summary: "Verify depot for IMPORT/EXPORT PendingDepot -> Completed" })
  async verifyDepot(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.verifyDepot(tenantId, jobId, userId);
  }

  @Post(":jobId/documents/quotation")
  @ApiOperation({ summary: "Upload quotation document (PDF/XLSX/XLS)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } })
  @UseInterceptors(FileInterceptor("file"))
  async uploadQuotation(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    const tenantId = req.tenant.tenantId;
    const userId = req.user?.userId ?? null;
    return this.jobs.uploadQuotation(tenantId, jobId, file, userId);
  }

  @Get(":jobId/documents")
  @ApiOperation({ summary: "List job documents" })
  async listDocuments(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    return this.jobs.listDocuments(tenantId, jobId);
  }

  @Get(":jobId/audit")
  @ApiOperation({ summary: "Get audit log for job" })
  async getAudit(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = req.tenant.tenantId;
    return this.jobs.getAudit(tenantId, jobId, limit ? parseInt(limit, 10) : undefined);
  }

  @Get(":jobId/tracking")
  @ApiOperation({ summary: "Get job tracking (last location, driver, vehicle)" })
  async getTracking(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    return this.jobs.getTracking(tenantId, jobId);
  }
}
