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
import { DriverJobsListQueryDto } from "./dto/driver-jobs-list-query.dto";
import { DriverJobsHistoryListQueryDto } from "./dto/driver-jobs-history-list-query.dto";
import { DriverCompleteJobDto } from "./dto/complete-job.dto";
import { JobLocationDto } from "./dto/location.dto";

@ApiTags("driver-jobs")
@Controller("drivers/jobs")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.DRIVER)
@ApiBearerAuth("JWT-auth")
export class DriverJobsController {
  constructor(private readonly driverJobs: DriverJobsService) {}

  @Get()
  @ApiOperation({ summary: "Alias for active jobs" })
  async list(
    @Req() req: any,
    @Query() query: DriverJobsListQueryDto,
  ): Promise<{ data: any[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listActiveByDriver(tenantId, userId, query);
  }

  @Get("active")
  @ApiOperation({ summary: "Active jobs assigned to driver" })
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
      "Start job without trips (Assigned -> InProgress). Multi-trip jobs must use trips/:tripId/start.",
  })
  async start(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.start(tenantId, jobId, userId);
  }

  @Post(":jobId/trips/:tripId/start")
  @ApiOperation({
    summary:
      "Start a trip leg: trailer number, Gul Circle location code, parking photo (multipart)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["parkingPhoto", "trailerNumber", "trailerLastLocationCode"],
      properties: {
        trailerNumber: { type: "string" },
        trailerLastLocationCode: { type: "string" },
        parkingPhoto: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor([{ name: "parkingPhoto", maxCount: 1 }]),
  )
  async startTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
    @UploadedFiles()
    files: { parkingPhoto?: Express.Multer.File[] },
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    const body = req.body as Record<string, string>;
    const trailerNumber = body?.trailerNumber?.trim() ?? "";
    const trailerLastLocationCode = body?.trailerLastLocationCode?.trim() ?? "";
    const parkingPhoto = files?.parkingPhoto?.[0];
    if (!parkingPhoto) {
      throw new BadRequestException("parkingPhoto is required");
    }
    return this.driverJobs.startTripWithTrailer(
      tenantId,
      jobId,
      tripId,
      userId,
      { trailerNumber, trailerLastLocationCode, parkingPhoto },
    );
  }

  @Post(":jobId/trips/:tripId/complete")
  @ApiOperation({ summary: "Complete trip leg (checks DO signature + required uploads)" })
  async completeTrip(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.completeTrip(tenantId, jobId, tripId, userId);
  }

  @Get(":jobId/documents")
  @ApiOperation({ summary: "List all job documents with signed URLs" })
  async listJobDocuments(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.listJobDocumentsForDriver(tenantId, jobId, userId);
  }

  @Get(":jobId/trips/:tripId/documents")
  @ApiOperation({ summary: "List trip-level documents with signed URLs" })
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