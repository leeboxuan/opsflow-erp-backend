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
  ApiExtraModels,
  getSchemaPath,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { DestructiveActionGuard } from "../../shared/auth/guards/destructive-action.guard";
import { DestructiveAction } from "../../shared/auth/guards/destructive-action.decorator";
import { Role, JobType, TripPendingState, TenantModule } from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";
import { InvoicesService } from "../finance/invoices.service";
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
  AssignJobTripDto,
  PatchTripPayoutDto,
  PatchJobTripDto,
  PatchTripDetailsDto,
  PublishJobTripRouteDto,
  PutTripPayoutLinesDto,
  ReorderJobTripsDto,
  SuggestJobTripOrderDto,
} from "../trips/dto/job-trip.dto";
import { JobDto, JobDocumentDto, JobTripResponseDto } from "./dto/job.dto";
import { SignTripDocumentDto } from "../documents/dto/sign-trip-document.dto";

@ApiTags("transport-jobs")
@Controller("jobs")
@UseGuards(
  AuthGuard,
  TenantGuard,
  RoleGuard,
  ModuleEntitlementGuard,
  DestructiveActionGuard,
)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
@ApiBearerAuth("JWT-auth")
@ApiExtraModels(JobDocumentDto)
export class TransportJobsController {
  constructor(
    private readonly jobs: TransportJobsService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get(":jobId/documents/:documentId/signed-url")
  @ApiOperation({ summary: "Get signed preview/download URLs for a job document" })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
  async getJobDocumentSignedUrl(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("documentId") documentId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getJobDocumentSignedUrl(
      tenantId,
      jobId,
      documentId,
      accessUser,
    );
  }

  @Get(":jobId/trips/:tripId/documents/:documentId/signed-url")
  @ApiOperation({ summary: "Get signed preview/download URLs for a trip document" })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
  async getTripDocumentSignedUrl(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Param("documentId") documentId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getTripDocumentSignedUrl(
      tenantId,
      jobId,
      tripId,
      documentId,
      accessUser,
    );
  }

  @Get()
  @ApiOperation({ summary: "List jobs with filters (slim rows for table view)" })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
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
    summary: "Create ONGOING job (ops fields only; no billing quotation snapshot)",
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
    summary: "Confirm import: create ONGOING jobs from validated rows",
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
    else if (jobTypeUpper === "COLLECTION") jobType = JobType.COLLECTION;
    else {
      throw new BadRequestException(
        "jobType must be one of: LCL, IMPORT, EXPORT, COLLECTION",
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
      "[Deprecated] Batch import confirm: prefer single-job create with trips. Creates ONGOING jobs using shared metadata and validated rows",
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
  @ApiOperation({ summary: "LCL Order In: confirm import, create ONGOING jobs" })
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
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
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
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
  async getOne(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getOne(tenantId, jobId, accessUser);
  }

  @Get(":jobId/invoice-prefill")
  @ApiOperation({ summary: "Build create-invoice prefill payload from job" })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  async invoicePrefill(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.invoices.getInvoicePrefillFromJob(tenantId, jobId, accessUser);
  }

  @Patch(":jobId")
  @ApiOperation({ summary: "Update job (not if COMPLETED/CANCELLED)" })
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
  @DestructiveAction({ resource: "JOB", action: "CANCEL" })
  @ApiOperation({
    summary: "Cancel job with reason (blocked when job has any trips)",
  })
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
  @DestructiveAction({ resource: "JOB", action: "DELETE" })
  @ApiOperation({
    summary: "Hard-delete job with no trips (ONGOING, unassigned)",
  })
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
    summary: "Mark IMPORT/EXPORT invoice completion handoff as COMPLETED",
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

  @Get(":jobId/documents")
  @ApiOperation({ summary: "List job documents" })
  @ApiOkResponse({
    description:
      "Returns only active job-level documents. Inactive/legacy versions are excluded from primary UI lists.",
    schema: {
      type: "array",
      example: [
        {
          id: "jobdoc_active_quotation_01",
          type: "QUOTATION",
          originalName: "signed-quotation-v2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 245112,
          isActive: true,
          createdAt: "2026-04-24T10:15:00.000Z",
          updatedAt: "2026-04-24T10:15:00.000Z",
          uploadedByUserId: "usr_ops_01",
          uploadedByName: "Ops Admin",
          generatedBySystem: false,
          generatedSource: null,
          signedAt: null,
          signedByUserId: null,
          signedByName: null,
          jobId: "job_001",
          tripId: null,
          previewUrl: "https://signed.example/preview/jobdoc_active_quotation_01",
          downloadUrl: "https://signed.example/download/jobdoc_active_quotation_01",
        },
      ],
    },
  })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
  async listDocuments(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.listDocuments(tenantId, jobId, accessUser);
  }

  @Get(":jobId/activity")
  @ApiOperation({ summary: "Get normalized job activity feed" })
  @ApiOkResponse({
    description:
      "Newest-first activity feed with trip context (tripSequence/displayTitle) and document lifecycle events.",
    schema: {
      type: "array",
      example: [
        {
          id: "audit_1001",
          scope: "TRIP",
          scopeId: "trip_001",
          tripId: "trip_001",
          tripSequence: 1,
          type: "DOC_GENERATED",
          label: "Delivery DO generated",
          documentType: "DELIVERY_DO",
          documentId: "tripdoc_delivery_do_01",
          fileName: "WF-2026-04-001-IMP_delivery-do.pdf",
          actorUserId: null,
          actorName: null,
          isSystem: true,
          metadata: {
            generatedBySystem: true,
            generatedSource: "AUTO_CREATE_JOB",
            displayTitle: "Port to Delivery Point",
          },
          createdAt: "2026-04-24T10:00:00.000Z",
        },
        {
          id: "audit_1002",
          scope: "TRIP",
          scopeId: "trip_001",
          tripId: "trip_001",
          tripSequence: 1,
          type: "DOC_REGENERATED",
          label: "Delivery DO regenerated",
          documentType: "DELIVERY_DO",
          documentId: "tripdoc_delivery_do_02",
          fileName: "WF-2026-04-001-IMP_delivery-do-v2.pdf",
          actorUserId: "usr_ops_01",
          actorName: "Ops Admin",
          isSystem: false,
          metadata: {
            generatedBySystem: true,
            generatedSource: "MANUAL_REGENERATE",
            previousDocumentId: "tripdoc_delivery_do_01",
            displayTitle: "Port to Delivery Point",
          },
          createdAt: "2026-04-24T10:20:00.000Z",
        },
      ],
    },
  })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
  async getActivity(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getActivity(tenantId, jobId, accessUser);
  }

  @Get(":jobId/audit")
  @ApiOperation({ summary: "Get audit log for job" })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
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
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE, Role.CUSTOMER)
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
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.CUSTOMER)
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

  @Delete(":jobId/trips/:tripId")
  @ApiOperation({ summary: "Delete/cancel trip by status rules" })
  async deleteTrip(
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
    return this.jobs.deleteTrip(tenantId, jobId, tripId, accessUser);
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

  @Post(":jobId/trips/suggest-order")
  @ApiOperation({ summary: "Suggest job trip order for planning (distance-based)" })
  async suggestTripOrder(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: SuggestJobTripOrderDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.suggestTripOrder(tenantId, jobId, dto, accessUser);
  }

  @Post(":jobId/trips/publish-route")
  @ApiOperation({ summary: "Apply planned route order and publish ready draft trips" })
  async publishTripRoute(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: PublishJobTripRouteDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.publishTripRoute(tenantId, jobId, dto, accessUser);
  }

  @Patch(":jobId/trips/:tripId/details")
  @ApiOperation({
    summary:
      "Update operational job/trip execution details (addresses, contacts, notes, planned timing)",
  })
  async patchTripDetails(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Body() dto: PatchTripDetailsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.patchTripDetails(tenantId, jobId, tripId, dto, accessUser);
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

  @Patch(":jobId/trips/:tripId/assign")
  @ApiOperation({ summary: "Assign driver and optional vehicle type to trip" })
  async assignTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Body() dto: AssignJobTripDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.assignTrip(tenantId, jobId, tripId, dto, accessUser);
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

  @Post(":jobId/trips/:tripId/unpublish")
  @ApiOperation({
    summary:
      "Unpublish a published trip back to draft (only before execution starts)",
  })
  async unpublishTrip(
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
    return this.jobs.unpublishTrip(tenantId, jobId, tripId, accessUser);
  }

  @Post(":jobId/trips/:tripId/mark-done")
  @ApiOperation({ summary: "Mark completed trip as done (admin/ops)" })
  async markTripDone(
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
    return this.jobs.markTripDone(tenantId, jobId, tripId, accessUser);
  }

  @Patch(":jobId/trips/:tripId/pending-state")
  @ApiOperation({ summary: "Update trip pending state (admin/ops)" })
  async updateTripPendingState(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Body()
    body: {
      pendingState: "NONE" | "PENDING_AT_PORT" | "PENDING_AT_DEPOT";
    },
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    const pendingState = String(body?.pendingState ?? "").trim() as TripPendingState;
    if (!Object.values(TripPendingState).includes(pendingState)) {
      throw new BadRequestException(
        "pendingState must be one of NONE, PENDING_AT_PORT, PENDING_AT_DEPOT",
      );
    }
    return this.jobs.updateTripPendingState(
      tenantId,
      jobId,
      tripId,
      pendingState,
      accessUser,
    );
  }

  @Get(":jobId/trips/:tripId/documents")
  @ApiOperation({ summary: "List trip documents with signed URLs" })
  @ApiOkResponse({
    description:
      "Returns only active trip-level documents. Replaced/inactive versions are omitted from primary document cards. Each item includes fileName, originalFileName, and fileSizeBytes; storage keys are never returned.",
    schema: {
      type: "array",
      items: { $ref: getSchemaPath(JobDocumentDto) },
      example: [
        {
          id: "tripdoc_delivery_do_active_01",
          type: "DELIVERY_DO",
          originalName: "WF-2026-04-001-IMP_delivery-do.pdf",
          fileName: "WF-2026-04-001-IMP_delivery-do.pdf",
          originalFileName: "WF-2026-04-001-IMP_delivery-do.pdf",
          mimeType: "application/pdf",
          sizeBytes: 184553,
          fileSizeBytes: 184553,
          isActive: true,
          createdAt: "2026-04-24T10:00:00.000Z",
          updatedAt: "2026-04-24T10:00:00.000Z",
          uploadedByUserId: null,
          uploadedByName: null,
          generatedBySystem: true,
          generatedSource: "AUTO_CREATE_JOB",
          signedAt: null,
          signedByUserId: null,
          signedByName: null,
          jobId: "job_001",
          tripId: "trip_001",
          previewUrl: "https://signed.example/preview/tripdoc_delivery_do_active_01",
          downloadUrl: "https://signed.example/download/tripdoc_delivery_do_active_01",
        },
      ],
    },
  })
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.CUSTOMER)
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
        type: {
          type: "string",
          enum: ["PICKUP_DO", "DELIVERY_DO", "POD_PHOTO", "POD_SIGNATURE", "OTHER"],
        },
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

  @Post(":jobId/trips/:tripId/documents/delivery-do/generate")
  @ApiOperation({ summary: "Generate or regenerate trip delivery DO PDF" })
  @ApiOkResponse({
    description:
      "Generates an active trip DELIVERY_DO document. Previous active DELIVERY_DO is deactivated automatically.",
    schema: {
      type: "object",
      example: {
        id: "tripdoc_delivery_do_active_02",
        type: "DELIVERY_DO",
        originalName: "WF-2026-04-001-IMP_delivery-do-v2.pdf",
        mimeType: "application/pdf",
        sizeBytes: 186101,
        isActive: true,
        createdAt: "2026-04-24T10:20:00.000Z",
        updatedAt: "2026-04-24T10:20:00.000Z",
        uploadedByUserId: "usr_ops_01",
        uploadedByName: "Ops Admin",
        generatedBySystem: true,
        generatedSource: "MANUAL_REGENERATE",
        signedAt: null,
        signedByUserId: null,
        signedByName: null,
        jobId: "job_001",
        tripId: "trip_001",
        previewUrl: "https://signed.example/preview/tripdoc_delivery_do_active_02",
        downloadUrl: "https://signed.example/download/tripdoc_delivery_do_active_02",
        tripSequence: 1,
        displayTitle: "Port to Delivery Point",
      },
    },
  })
  async generateTripDeliveryDo(
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
    return this.jobs.generateTripDeliveryDoDocument(
      tenantId,
      jobId,
      tripId,
      accessUser,
      "MANUAL_REGENERATE",
    );
  }

  @Post(":jobId/trips/:tripId/documents/:documentId/sign")
  @ApiOperation({ summary: "Mark trip document as signed (ops/admin)" })
  async signTripDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Param("documentId") documentId: string,
    @Body() body: SignTripDocumentDto,
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
      body,
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

  @Patch(":jobId/trips/:tripId/payout")
  @ApiOperation({ summary: "Save trip payout draft (master rate + payout lines)" })
  async patchTripPayout(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Body() dto: PatchTripPayoutDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.saveTripPayoutDraft(
      tenantId,
      jobId,
      tripId,
      dto,
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

}