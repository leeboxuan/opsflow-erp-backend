import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  Body,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
} from "@nestjs/swagger";
import {
  FileInterceptor,
  FileFieldsInterceptor,
} from "@nestjs/platform-express";
import { TripDocumentType } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { TenantModule } from "@prisma/client";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { Roles } from "../../shared/auth/guards/role.guard";
import { Role } from "@prisma/client";
import {
  DriverJobsService,
  DRIVER_UPLOADABLE_TRIP_DOCUMENT_TYPES,
} from "./driver-jobs.service";
import { JobDocumentDto } from "../jobs/dto/job.dto";
import { DriverJobsListQueryDto } from "./dto/driver-jobs-list-query.dto";
import { DriverJobsHistoryListQueryDto } from "./dto/driver-jobs-history-list-query.dto";
import { DriverCompleteJobDto } from "./dto/complete-job.dto";
import { JobLocationDto } from "./dto/location.dto";
import { DriverTripCompleteDto } from "./dto/driver-trip-complete.dto";
import { UpdateDriverOperationalDetailsDto } from "./dto/update-driver-operational-details.dto";
import { ContainerDocumentationRequirementDto } from "./dto/container-documentation-requirement.dto";
import { SignTripDocumentDto } from "../documents/dto/sign-trip-document.dto";
import { AccessSurface } from "../../shared/auth/guards/access-surface.guard";

@ApiTags("driver-jobs")
@Controller("drivers/jobs")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.DRIVER)
@AccessSurface("driver")
@ApiBearerAuth("JWT-auth")
@ApiExtraModels(JobDocumentDto, ContainerDocumentationRequirementDto)
export class DriverJobsController {
  constructor(private readonly driverJobs: DriverJobsService) {}

  @Get()
  @ApiOperation({
    summary: "Alias for active jobs",
    description:
      "Each job includes trips with execution-card fields (jobId, jobInternalRef, customerName, jobType, origin/destination summaries, resolved pickup/delivery address lines, notes, earnings, trailerNumber) for Home/current-trip UI.",
  })
  async list(
    @Req() req: any,
    @Query() query: DriverJobsListQueryDto,
  ): Promise<{ data: any[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listActiveByDriver(tenantId, userId, query);
  }

  @Get("active")
  @ApiOperation({
    summary: "Active jobs assigned to driver",
    description:
      "Trips include execution-card fields (job context, route summaries, resolved addresses, notes, driverEarningCents, earningLabelSnapshot, trailerNumber) for mobile Home.",
  })
  async listActive(
    @Req() req: any,
    @Query() query: DriverJobsListQueryDto,
  ): Promise<{ data: any[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listActiveByDriver(tenantId, userId, query);
  }

  @Get("history")
  @ApiOperation({
    summary: "Driver trip history (completed legs) with year/month filters",
    description:
      "Paginates completed (COMPLETED/DONE) trips assigned to the driver. Each job row includes only those trips on the page; parent job may still be ONGOING. Filters use trip closedAt (fallback updatedAt) in tenant timezone. Newest-completed trips first.",
  })
  async listHistory(
    @Req() req: any,
    @Query() query: DriverJobsHistoryListQueryDto,
  ): Promise<{ data: any[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listHistoryByDriver(tenantId, userId, query);
  }

  @Get("history/summary")
  @ApiOperation({
    summary: "History year/month bucket summary for accordion UI",
    description:
      "Buckets completed (COMPLETED/DONE) trips assigned to the driver by trip closedAt (fallback updatedAt), in tenant timezone. Parent job may still be ONGOING.",
  })
  async historySummary(@Req() req: any): Promise<any> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getHistorySummaryByDriver(tenantId, userId);
  }

  @Get(":jobId")
  @ApiOperation({ summary: "Get full job detail (only if assigned to driver)" })
  async getOne(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getOneForDriver(tenantId, jobId, userId);
  }

  @Post(":jobId/start")
  @ApiOperation({
    summary:
      "Start job without trips (ONGOING lifecycle). Multi-trip jobs must use trips/:tripId/start.",
  })
  async start(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.start(tenantId, jobId, userId);
  }

  @Post(":jobId/trips/:tripId/start")
  @ApiOperation({
    summary:
      "Start a trip leg: chassis selection + trailer photo (multipart)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["trailerPhoto", "chassisId"],
      properties: {
        chassisId: { type: "string" },
        trailerNumber: {
          type: "string",
          description:
            "Optional display compatibility; authoritative number comes from chassis register",
        },
        trailerPhoto: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor([{ name: "trailerPhoto", maxCount: 1 }]),
  )
  async startTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @UploadedFiles()
    files: { trailerPhoto?: Express.Multer.File[] },
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    const body = req.body as Record<string, string>;
    const chassisId = body?.chassisId?.trim() ?? "";
    const trailerNumber = body?.trailerNumber?.trim() ?? "";
    const trailerPhoto = files?.trailerPhoto?.[0];
    if (!trailerPhoto) {
      throw new BadRequestException("trailerPhoto is required");
    }
    if (!chassisId) {
      throw new BadRequestException("chassisId is required");
    }
    return this.driverJobs.startTripWithTrailer(
      tenantId,
      jobId,
      tripId,
      userId,
      { chassisId, trailerNumber, trailerPhoto },
    );
  }

  @Patch(":jobId/trips/:tripId/operational-details")
  @ApiOperation({
    summary: "Update driver operational details for an assigned trip",
    description:
      "Allows the assigned driver to update container number, seal number, and driver remarks while the trip is PUBLISHED or ONGOING. Does not overwrite Job.description.",
  })
  async updateOperationalDetails(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Body() dto: UpdateDriverOperationalDetailsDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.updateOperationalDetails(
      tenantId,
      jobId,
      tripId,
      userId,
      dto,
    );
  }

  @Get(":jobId/trips/:tripId/completion-requirements")
  @ApiOperation({ summary: "Get completion requirements before trip complete" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        canComplete: { type: "boolean" },
        missingDocuments: { type: "array", items: { type: "string" } },
        containerDocumentation: {
          type: "array",
          items: {
            $ref: getSchemaPath(ContainerDocumentationRequirementDto),
          },
        },
        missingContainerDocumentation: {
          type: "array",
          items: {
            $ref: getSchemaPath(ContainerDocumentationRequirementDto),
          },
        },
      },
    },
  })
  async getTripCompletionRequirements(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getTripCompletionRequirements(tenantId, jobId, tripId, userId);
  }

  @Post(":jobId/trips/:tripId/complete")
  @ApiOperation({ summary: "Complete trip leg (checks DO signature + required uploads)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        trailerEndPhoto: { type: "string", format: "binary" },
        trailerParkingLocationCode: { type: "string" },
        trailerParkingAddress1: { type: "string" },
        trailerParkingAddress2: { type: "string" },
        trailerParkingPostal: { type: "string" },
        trailerParkingPlaceId: { type: "string" },
        trailerParkingLat: { type: "number" },
        trailerParkingLng: { type: "number" },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor([{ name: "trailerEndPhoto", maxCount: 1 }]),
  )
  async completeTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @UploadedFiles()
    files: { trailerEndPhoto?: Express.Multer.File[] },
    @Body() dto: DriverTripCompleteDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.completeTrip(tenantId, jobId, tripId, userId, {
      ...dto,
      trailerEndPhoto: files?.trailerEndPhoto?.[0],
    });
  }

  @Get(":jobId/documents")
  @ApiOperation({ summary: "List all job documents with signed URLs" })
  @ApiOkResponse({
    schema: {
      type: "array",
      items: { $ref: getSchemaPath(JobDocumentDto) },
    },
  })
  async listJobDocuments(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listJobDocumentsForDriver(tenantId, jobId, userId);
  }

  @Get(":jobId/trips/:tripId/documents")
  @ApiOperation({ summary: "List trip-level documents with signed URLs" })
  @ApiOkResponse({
    schema: {
      type: "array",
      items: { $ref: getSchemaPath(JobDocumentDto) },
    },
  })
  async listTripDocuments(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listTripDocumentsForDriver(
      tenantId,
      jobId,
      tripId,
      userId,
    );
  }

  @Post(":jobId/trips/:tripId/documents")
  @ApiOperation({
    summary: "Upload trip document (form field type + file)",
    description:
      "CONTAINER_PHOTO and SEAL_PHOTO require jobItemId for the exact container row and append as additional active photos (up to 10 per category per container on the trip). Other document types reject jobItemId. Returns document metadata only (no signed URLs); fetch preview via GET .../documents/:documentId/signed-url.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "type"],
      properties: {
        type: {
          type: "string",
          example: "OTHER",
          enum: [
            "PICKUP_DO",
            "DELIVERY_DO",
            "POD_PHOTO",
            "POD_SIGNATURE",
            "OTHER",
            "CONTAINER_PHOTO",
            "SEAL_PHOTO",
            "TRAILER_START_PHOTO",
            "TRAILER_END_PHOTO",
          ],
        },
        jobItemId: {
          type: "string",
          description:
            "Required for CONTAINER_PHOTO and SEAL_PHOTO; rejected for other types.",
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
    const userId = req.user.userId;
    const body = req.body as Record<string, string>;
    const typeRaw = String(body?.type ?? body?.documentType ?? "")
      .trim()
      .toUpperCase();
    const allowed = DRIVER_UPLOADABLE_TRIP_DOCUMENT_TYPES as readonly string[];
    if (!typeRaw || !allowed.includes(typeRaw)) {
      console.warn("driver_trip_doc_upload_rejected", {
        receivedType: typeRaw || null,
        supportedTypes: [...allowed],
        tripId,
        userId,
      });
      throw new BadRequestException("Unsupported trip document type");
    }
    const type = typeRaw as TripDocumentType;
    const jobItemId = String(body?.jobItemId ?? "").trim() || null;
    const requiresSignature = String(body?.requiresSignature ?? "").toLowerCase() === "true";
    return this.driverJobs.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      userId,
      type,
      file,
      requiresSignature,
      { email: req.user?.email ?? null },
      jobItemId,
    );
  }

  @Delete(":jobId/trips/:tripId/documents/:documentId")
  @ApiOperation({ summary: "Delete own trip photo documentation (soft delete)" })
  async deleteTripDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Param("documentId") documentId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.deleteTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      documentId,
      userId,
    );
  }

  @Post(":jobId/trips/:tripId/documents/:type/ensure-generated")
  @ApiOperation({
    summary: "Ensure required Delivery DO / Lorry Chit exists for this trip",
    description:
      "Idempotent. When the trip requires Delivery DO or Lorry Chit and no active document exists, generates it once. Returns the existing active document when already present.",
  })
  async ensureRequiredTripDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Param("type") type: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.ensureRequiredTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      userId,
      type,
    );
  }

  @Get("wallet/summary")
  @ApiOperation({
    summary: "Driver wallet summary for month (YYYY-MM)",
    description:
      "Returns completed trip earnings for the authenticated driver in the selected month.",
  })
  async walletSummary(@Req() req: any, @Query("month") month: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getWalletSummaryByMonth(tenantId, userId, month);
  }

  @Post(":jobId/trips/:tripId/documents/:documentId/sign")
  @ApiOperation({
    summary: "Mark trip document as signed",
    description:
      "Accepts signedByName, signedAt, signatureBase64, signatureImage (data URL), and signatureContentType from mobile.",
  })
  async signTripDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Param("documentId") documentId: string,
    @Body() body: SignTripDocumentDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.signTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      documentId,
      userId,
      body,
    );
  }

  @Post(":jobId/location")
  @ApiOperation({ summary: "Update job location (lat/lng)" })
  async updateLocation(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: JobLocationDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    await this.driverJobs.updateLocation(tenantId, jobId, userId, dto);
  }

  @Post(":jobId/complete")
  @ApiOperation({ summary: "Complete job (POD + signature required)" })
  async complete(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() _dto: DriverCompleteJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.complete(tenantId, jobId, userId);
  }
}