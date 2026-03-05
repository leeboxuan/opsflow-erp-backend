import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { FileInterceptor, FileFieldsInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RoleGuard } from "../auth/guards/role.guard";
import { Roles } from "../auth/guards/role.guard";
import { Role } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";
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
  @ApiOperation({ summary: "List jobs assigned to driver for date (default today)" })
  async list(
    @Req() req: any,
    @Query("date") date?: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    const dateStr = date ?? new Date().toISOString().slice(0, 10);
    return this.driverJobs.listByDriver(tenantId, userId, dateStr);
  }

  @Get(":jobId")
  @ApiOperation({ summary: "Get job (only if assigned to driver)" })
  async getOne(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getOneForDriver(tenantId, jobId, userId);
  }

  @Post(":jobId/start")
  @ApiOperation({ summary: "Start job (Assigned -> InProgress)" })
  async start(@Req() req: any, @Param("jobId") jobId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.start(tenantId, jobId, userId);
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

  @Post(":jobId/pod/photos")
  @ApiOperation({ summary: "Upload POD photo(s)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string", format: "binary" } },
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileFieldsInterceptor([{ name: "files", maxCount: 10 }, { name: "file", maxCount: 1 }]))
  async uploadPodPhotos(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @UploadedFiles() files: { files?: Express.Multer.File[]; file?: Express.Multer.File[] },
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    const list: Express.Multer.File[] = [];
    if (files?.files?.length) list.push(...files.files);
    if (files?.file?.length) list.push(...files.file);
    if (!list.length) throw new BadRequestException("At least one file required");
    return this.driverJobs.uploadPodPhotos(tenantId, jobId, userId, list);
  }

  @Post(":jobId/pod/signature")
  @ApiOperation({ summary: "Upload POD signature image" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } })
  @UseInterceptors(FileInterceptor("file"))
  async uploadPodSignature(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.uploadPodSignature(tenantId, jobId, userId, file);
  }

  @Post(":jobId/complete")
  @ApiOperation({ summary: "Complete job (POD + signature required)" })
  async complete(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Body() dto: DriverCompleteJobDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.complete(tenantId, jobId, userId, dto);
  }
}
