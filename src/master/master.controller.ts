import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { MasterDataService } from "./master.service";
import { MasterFileType, Role } from "@prisma/client";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import {
  CreateDriverTripRateMasterDto,
  DriverTripRateImportSummaryDto,
  UpdateDriverTripRateMasterDto,
} from "./dto/driver-trip-rate-master.dto";

@ApiTags("master-data")
@Controller("master")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@ApiBearerAuth("JWT-auth")
export class MasterDataController {
  constructor(private readonly master: MasterDataService) {}

  @Get("singapore-ports")
  @ApiOperation({ summary: "Singapore port terminal codes (controlled list)" })
  singaporePorts() {
    return this.master.listSingaporePorts();
  }

  @Get("singapore-depots")
  @ApiOperation({ summary: "Singapore depot codes (controlled list)" })
  singaporeDepots() {
    return this.master.listSingaporeDepots();
  }

  @Get("trailer-locations")
  @ApiOperation({
    summary: "Trailer last-location codes (7 Gul Circle options; extendable)",
  })
  trailerLocations() {
    return this.master.listTrailerLocations();
  }

  @Get("driver-trip-rates")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "List tenant-scoped driver trip rate master rows" })
  listDriverTripRates(@Req() req: any) {
    return this.master.listDriverTripRateMasters(req.tenant.tenantId);
  }

  @Post("driver-trip-rates")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "Create tenant-scoped driver trip rate master row" })
  createDriverTripRate(
    @Req() req: any,
    @Body() dto: CreateDriverTripRateMasterDto,
  ) {
    return this.master.createDriverTripRateMaster(req.tenant.tenantId, dto);
  }

  @Patch("driver-trip-rates/:id")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "Update tenant-scoped driver trip rate master row" })
  updateDriverTripRate(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateDriverTripRateMasterDto,
  ) {
    return this.master.updateDriverTripRateMaster(req.tenant.tenantId, id, dto);
  }

  @Patch("driver-trip-rates/:id/deactivate")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "Deactivate/archive a driver trip rate master row" })
  deactivateDriverTripRate(@Req() req: any, @Param("id") id: string) {
    return this.master.deactivateDriverTripRateMaster(req.tenant.tenantId, id);
  }

  @Post("driver-trip-rates/import")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({
    summary:
      "Import DriverTripRateMaster from Excel and upsert by tenantId+code",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  importDriverTripRates(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<DriverTripRateImportSummaryDto> {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.master.importDriverTripRateMastersFromExcel(
      req.tenant.tenantId,
      file.buffer,
    );
  }

  @Post("files/:type/upload")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "Upload and parse a master file version" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        effectiveDate: { type: "string", example: "2026-04-17" },
        customerCompanyId: { type: "string" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  uploadMasterFile(
    @Req() req: any,
    @Param("type") type: MasterFileType,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { effectiveDate?: string; customerCompanyId?: string },
  ) {
    if (!file) throw new BadRequestException("file is required");
    if (!Object.values(MasterFileType).includes(type)) {
      throw new BadRequestException(`Invalid type: ${type}`);
    }
    return this.master.uploadAndParseMasterFile(
      req.tenant.tenantId,
      type,
      file,
      req.user?.userId ?? null,
      body?.effectiveDate,
      body?.customerCompanyId ?? null,
    );
  }

  @Get("files")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "List uploaded master files" })
  listMasterFiles(@Req() req: any) {
    return this.master.listMasterFiles(req.tenant.tenantId);
  }

  @Get("files/:type/active/items")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "Get active parsed items for a master file type" })
  getActiveMasterItems(
    @Req() req: any,
    @Param("type") type: MasterFileType,
    @Query("customerCompanyId") customerCompanyId?: string,
  ) {
    if (!Object.values(MasterFileType).includes(type)) {
      throw new BadRequestException(`Invalid type: ${type}`);
    }
    return this.master.getActiveMasterItems(
      req.tenant.tenantId,
      type,
      customerCompanyId ?? null,
    );
  }

  @Patch("files/:id/activate")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({ summary: "Activate a specific master file version" })
  activateMasterFile(@Req() req: any, @Param("id") id: string) {
    return this.master.activateMasterFile(req.tenant.tenantId, id);
  }

  @Post("files/:id/reprocess")
  @Roles(Role.ADMIN, Role.OPS, Role.FINANCE)
  @ApiOperation({
    summary:
      "Reprocess by downloading stored source file and replacing parsed rows for this master file",
  })
  async reprocessMasterFile(@Req() req: any, @Param("id") id: string) {
    return this.master.reprocessMasterFile(req.tenant.tenantId, id);
  }
}
