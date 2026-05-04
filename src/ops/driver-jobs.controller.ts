import {
  Controller,
  Get,
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
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RoleGuard } from "../auth/guards/role.guard";
import { Roles } from "../auth/guards/role.guard";
import { Role } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";
import { JobDocumentDto } from "./dto/job.dto";
import { DriverJobsListQueryDto } from "./dto/driver-jobs-list-query.dto";
import { DriverJobsHistoryListQueryDto } from "./dto/driver-jobs-history-list-query.dto";
import { DriverCompleteJobDto } from "./dto/complete-job.dto";
import { JobLocationDto } from "./dto/location.dto";
import { DriverTripCompleteDto } from "./dto/driver-trip-complete.dto";

@ApiTags("driver-jobs")
@Controller("drivers/jobs")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.DRIVER)
@ApiBearerAuth("JWT-auth")
@ApiExtraModels(JobDocumentDto)
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
  @ApiOperation({ summary: "Driver job history (completed/cancelled) with year/month filters" })
  async listHistory(
    @Req() req: any,
    @Query() query: DriverJobsHistoryListQueryDto,
  ): Promise<{ data: any[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listHistoryByDriver(tenantId, userId, query);
  }

  @Get("history/summary")
  @ApiOperation({ summary: "History year/month bucket summary for accordion UI" })
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
      "Start a trip leg: trailer number + trailer photo (multipart)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["trailerPhoto", "trailerNumber"],
      properties: {
        trailerNumber: { type: "string" },
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
    const trailerNumber = body?.trailerNumber?.trim() ?? "";
    const trailerPhoto = files?.trailerPhoto?.[0];
    if (!trailerPhoto) {
      throw new BadRequestException("trailerPhoto is required");
    }
    return this.driverJobs.startTripWithTrailer(
      tenantId,
      jobId,
      tripId,
      userId,
      { trailerNumber, trailerPhoto },
    );
  }

  @Get(":jobId/trips/:tripId/completion-requirements")
  @ApiOperation({ summary: "Get completion requirements before trip complete" })
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
  @ApiOperation({ summary: "Upload trip document (form field type + file)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "type"],
      properties: {
        type: {
          type: "string",
          example: "POD_PHOTO",
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
    const userId = req.user.userId;
    const body = req.body as Record<string, string>;
    const typeRaw = (body?.type ?? "").trim().toUpperCase();
    const allowed = Object.values(TripDocumentType) as string[];
    if (!typeRaw || !allowed.includes(typeRaw)) {
      throw new BadRequestException("type must be a valid TripDocumentType");
    }
    const type = typeRaw as TripDocumentType;
    const requiresSignature = String(body?.requiresSignature ?? "").toLowerCase() === "true";
    return this.driverJobs.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      userId,
      type,
      file,
      requiresSignature,
    );
  }

  @Post(":jobId/trips/:tripId/documents/:documentId/sign")
  @ApiOperation({ summary: "Mark trip document as signed" })
  async signTripDocument(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @Param("documentId") documentId: string,
    @Body() body: { signedByName?: string },
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.signTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      documentId,
      userId,
      body?.signedByName,
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