import {
  Controller,
  Get,
  Post,
  Put,
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
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RoleGuard } from "../auth/guards/role.guard";
import { Roles } from "../auth/guards/role.guard";
import { Role, JobType } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";
import { CreateJobDto } from "./dto/create-job.dto";
import { UpdateJobDto } from "./dto/update-job.dto";
import { AssignJobDto } from "./dto/assign-job.dto";
import { CancelJobDto } from "./dto/cancel-job.dto";
import { JobListQueryDto } from "./dto/job-list-query.dto";
import { ImportConfirmRequestDto } from "./dto/import-job-row.dto";
import { LclImportConfirmRequestDto } from "./dto/lcl-import.dto";
import { JobBatchImportConfirmRequestDto } from "./dto/job-batch-import.dto";
import { SaveJobChargesDto } from "./dto/save-job-charges.dto";
import {
  AppendJobTripDto,
  PatchJobTripDto,
  PutTripPayoutLinesDto,
  ReorderJobTripsDto,
} from "./dto/job-trip.dto";
import { JobDto, JobTripResponseDto } from "./dto/job.dto";

@ApiTags("ops-jobs")
@Controller("jobs")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
@ApiBearerAuth("JWT-auth")
export class OpsJobsController {
  constructor(private readonly jobs: OpsJobsService) {}

  @Get()
  @ApiOperation({ summary: "List jobs with filters" })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async list(@Req() req: any, @Query() query: JobListQueryDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.list(tenantId, query, accessUser);
  }

  @Get("meta/driver-trip-rates")
  @ApiOperation({
    summary: "List tenant driver earning options for trip assignment",
  })
  async listDriverTripRates(@Req() req: any) {
    return this.jobs.listDriverTripRateMasters(req.tenant.tenantId);
  }

  @Get("meta/dhc-references")
  @ApiOperation({ summary: "List depot / DHC reference rows for charge picker" })
  async listDhc(@Req() req: any) {
    return this.jobs.listDepotHandlingReferences(req.tenant.tenantId);
  }

  @Post()
  @ApiOperation({
    summary: "Create Draft job (ops fields only; no billing quotation snapshot)",
  })
  async create(@Req() req: any, @Body() dto: CreateJobDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.create(tenantId, dto, accessUser);
  }

  @Post("import/preview")
  @ApiOperation({
    summary: "Preview Excel import: parse and validate rows, no DB writes",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
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
  @ApiOperation({
    summary: "Confirm import: create Draft jobs from validated rows",
  })
  async importConfirm(@Req() req: any, @Body() dto: ImportConfirmRequestDto) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.importConfirm(tenantId, dto.rows, accessUser);
  }

  @Post("import/batch/preview")
  @ApiOperation({
    summary:
      "[Deprecated] Batch import preview: prefer single-job create with trips. Excel row data only; customerCompanyId and jobType in form fields",
    deprecated: true,
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "customerCompanyId", "jobType"],
      properties: {
        file: { type: "string", format: "binary" },
        customerCompanyId: { type: "string" },
        jobType: { type: "string", example: "LCL" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async batchImportPreview(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");

    const body = req.body as Record<string, string>;
    const customerCompanyId = body?.customerCompanyId?.trim();
    const jobTypeRaw = body?.jobType?.trim();

    if (!customerCompanyId || !jobTypeRaw) {
      throw new BadRequestException(
        "customerCompanyId and jobType are required",
      );
    }

    const jobTypeUpper = jobTypeRaw.toUpperCase();
    let jobType: JobType;
    if (jobTypeUpper === "LCL") jobType = JobType.LCL;
    else if (jobTypeUpper === "IMPORT") jobType = JobType.IMPORT;
    else if (jobTypeUpper === "EXPORT") jobType = JobType.EXPORT;
    else {
      throw new BadRequestException(
        "jobType must be one of: LCL, IMPORT, EXPORT",
      );
    }

    const tenantId = req.tenant.tenantId;

    return this.jobs.batchImportPreview(tenantId, file.buffer, {
      customerCompanyId,
      jobType,
    });
  }

  @Post("import/batch/confirm")
  @ApiOperation({
    summary:
      "[Deprecated] Batch import confirm: prefer single-job create with trips. Creates Draft jobs using shared metadata and validated rows",
    deprecated: true,
  })
  async batchImportConfirm(
    @Req() req: any,
    @Body() dto: JobBatchImportConfirmRequestDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.batchImportConfirm(tenantId, dto, accessUser);
  }

  @Post("import/lcl/preview")
  @ApiOperation({
    summary: "LCL Order In: preview Excel (group by Order Ref), no DB writes",
  })
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
  async lclImportPreview(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
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
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.lclImportConfirm(tenantId, dto, accessUser);
  }

  @Get("tracking/live")
  @ApiOperation({ summary: "List live trip tracking rows for active/published trips" })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async listLiveTracking(@Req() req: any) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.listLiveTripTracking(tenantId, accessUser);
  }

  @Get(":jobId")
  @ApiOperation({ summary: "Get job by id" })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async getOne(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getOne(tenantId, jobId, accessUser);
  }

  @Patch(":jobId")
  @ApiOperation({ summary: "Update job (not if Completed/Cancelled)" })
  async update(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: UpdateJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.update(tenantId, jobId, dto, accessUser);
  }

  @Post(":jobId/assign")
  @ApiOperation({ summary: "Assign driver and optional vehicle or fleet vehicle to job" })
  async assign(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: AssignJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.assign(tenantId, jobId, dto, accessUser);
  }

  @Post(":jobId/cancel")
  @ApiOperation({ summary: "Cancel job with reason" })
  async cancel(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: CancelJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.cancel(tenantId, jobId, dto, accessUser);
  }

  @Delete(":jobId")
  @ApiOperation({ summary: "Delete job (only if Draft or unassigned Assigned)" })
  async delete(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    await this.jobs.delete(tenantId, jobId, accessUser);
  }

  @Post(":jobId/verify-depot")
  @ApiOperation({
    summary: "Verify depot for IMPORT/EXPORT PendingDepot -> Completed",
  })
  async verifyDepot(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.verifyDepot(tenantId, jobId, accessUser);
  }

  @Post(":jobId/documents/quotation")
  @ApiOperation({
    summary:
      "Attach or replace an optional quotation document on an existing job (not required for job creation)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadQuotation(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.uploadQuotation(tenantId, jobId, file, accessUser);
  }

  @Post(":jobId/documents/other")
  @ApiOperation({
    summary:
      "Upload generic job document (appends; PDF, Office, images, csv, txt, zip)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadOtherDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.uploadOtherDocument(tenantId, jobId, file, accessUser);
  }

  @Post(":jobId/documents/do/generate")
  @ApiOperation({ summary: "Generate DO PDF for job" })
  async generateDo(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.generateDoDocument(tenantId, jobId, accessUser);
  }

  @Get(":jobId/documents")
  @ApiOperation({ summary: "List job documents" })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async listDocuments(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.listDocuments(tenantId, jobId, accessUser);
  }

  @Get(":jobId/audit")
  @ApiOperation({ summary: "Get audit log for job" })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async getAudit(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getAudit(
      tenantId,
      jobId,
      limit ? parseInt(limit, 10) : undefined,
      accessUser,
    );
  }

  @Get(":jobId/tracking")
  @ApiOperation({ summary: "Get job tracking (last location, driver, vehicle)" })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async getTracking(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getTracking(tenantId, jobId, accessUser);
  }

  @Get(":jobId/trips")
  @ApiOperation({ summary: "List all trips for a job ordered by sequence" })
  @ApiOkResponse({ type: JobTripResponseDto, isArray: true })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async listTrips(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.listTrips(tenantId, jobId, accessUser);
  }

  @Get(":jobId/charges/available")
  @ApiOperation({
    summary:
      "[Deprecated] Billing charge options for an existing job: quotation lines, DHC refs, and current charge snapshot",
  })
  async getAvailableCharges(
    @Req() req: any,
    @Param("jobId") jobId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getBillingChargeOptionsForJob(tenantId, jobId, accessUser);
  }

  @Get(":jobId/billing-charge-options")
  @ApiOperation({
    summary:
      "Billing charge options for an existing job (quotation lines, DHC refs, current snapshot)",
  })
  async getBillingChargeOptions(
    @Req() req: any,
    @Param("jobId") jobId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getBillingChargeOptionsForJob(tenantId, jobId, accessUser);
  }

  @Put(":jobId/charges")
  @ApiOperation({ summary: "Replace frozen JobCharge snapshot for a job" })
  async saveCharges(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: SaveJobChargesDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.saveJobCharges(tenantId, jobId, dto, accessUser);
  }

  @Post(":jobId/trips")
  @ApiOperation({ summary: "Append a draft trip to an existing job" })
  async appendTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: AppendJobTripDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.appendTrip(tenantId, jobId, dto, accessUser);
  }

  @Patch(":jobId/trips/reorder")
  @ApiOperation({ summary: "Resequence trips on a job" })
  async reorderTrips(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: ReorderJobTripsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.reorderTrips(tenantId, jobId, dto, accessUser);
  }

  @Patch(":jobId/trips/:tripId")
  @ApiOperation({ summary: "Update trip metadata or assign driver earning rate" })
  async patchTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Body() dto: PatchJobTripDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.patchTrip(tenantId, jobId, tripId, dto, accessUser);
  }

  @Post(":jobId/trips/:tripId/publish")
  @ApiOperation({
    summary:
      "Publish a draft trip for driver execution (requires assigned driver payout)",
  })
  @ApiOkResponse({ type: JobDto })
  async publishTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.publishTrip(tenantId, jobId, tripId, accessUser);
  }

  @Get(":jobId/trips/:tripId/documents")
  @ApiOperation({ summary: "List trip documents with signed URLs" })
  @Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
  async listTripDocuments(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.listTripDocuments(tenantId, jobId, tripId, accessUser);
  }

  @Post(":jobId/trips/:tripId/documents")
  @ApiOperation({ summary: "Upload trip document (ops/admin)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["type", "file"],
      properties: {
        type: { type: "string" },
        requiresSignature: { type: "boolean" },
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadTripDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.uploadTripDocument(
      tenantId,
      jobId,
      tripId,
      String(req.body?.type ?? ""),
      file,
      String(req.body?.requiresSignature ?? "").toLowerCase() === "true",
      accessUser,
    );
  }

  @Post(":jobId/trips/:tripId/documents/:documentId/sign")
  @ApiOperation({ summary: "Mark trip document as signed (ops/admin)" })
  async signTripDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Param("documentId") documentId: string,
    @Body() body: { signedByName?: string },
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.signTripDocument(
      tenantId,
      jobId,
      tripId,
      documentId,
      body?.signedByName,
      accessUser,
    );
  }

  @Get(":jobId/trips/:tripId/payout-lines")
  @ApiOperation({ summary: "List payout lines for a trip" })
  async listTripPayoutLines(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.listTripPayoutLines(tenantId, jobId, tripId, accessUser);
  }

  @Put(":jobId/trips/:tripId/payout-lines")
  @ApiOperation({ summary: "Replace payout lines for a trip" })
  async putTripPayoutLines(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Body() dto: PutTripPayoutLinesDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.replaceTripPayoutLines(
      tenantId,
      jobId,
      tripId,
      dto.lines ?? [],
      accessUser,
    );
  }

  @Post(":jobId/send-to-invoice")
  @ApiOperation({
    summary:
      "Mark a job invoice-ready after all trips are completed (ops-to-finance handoff)",
  })
  @ApiOkResponse({ type: JobDto })
  async sendToInvoice(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.sendJobToInvoice(tenantId, jobId, accessUser);
  }

  @Post(":jobId/documents/pickup-do")
  @ApiOperation({ summary: "Upload pickup DO (admin/ops)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadPickupDo(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.uploadPickupDo(tenantId, jobId, file, accessUser);
  }
}