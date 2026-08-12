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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { TenantModule } from "@prisma/client";
import { MasterDataService } from "./master.service";
import {
  LogisticsLocationType,
  MasterFileType,
  MasterRateDatasetType,
  Role,
} from "@prisma/client";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  CreateDriverTripRateMasterDto,
  DriverTripRateImportSummaryDto,
  UpdateDriverTripRateMasterDto,
} from "./dto/driver-trip-rate-master.dto";
import { SaveMasterQuotationItemsDto } from "./dto/master-file-items.dto";
import { SaveQuotationDatasetDto } from "./dto/quotation-dataset.dto";
import { SaveTruckingRatesDatasetDto } from "./dto/trucking-rate-dataset.dto";
import { SaveDhcRatesDatasetDto } from "./dto/dhc-rate-dataset.dto";
import { SingaporeLocationDto } from "./dto/singapore-location.dto";

@ApiTags("master-data")
@Controller("master")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@ApiBearerAuth("JWT-auth")
export class MasterDataController {
  constructor(private readonly master: MasterDataService) {}

  @Get("singapore-ports")
  @ApiOperation({ summary: "Singapore port terminal codes (controlled list)" })
  @ApiOkResponse({ type: SingaporeLocationDto, isArray: true })
  singaporePorts() {
    return this.master.listSingaporePorts();
  }

  @Get("singapore-depots")
  @ApiOperation({ summary: "Singapore depot codes (controlled list)" })
  @ApiOkResponse({ type: SingaporeLocationDto, isArray: true })
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

  @Get("logistics-locations")
  @ApiOperation({ summary: "List map-ready logistics location masters (port/depot)" })
  logisticsLocations(@Query("type") type?: LogisticsLocationType) {
    return this.master.listLogisticsLocations(type);
  }

  @Get("logistics-locations/:id")
  @ApiOperation({ summary: "Get map-ready logistics location by id" })
  logisticsLocationById(@Param("id") id: string) {
    return this.master.getLogisticsLocationById(id);
  }

  @Get("driver-trip-rates")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List tenant-scoped driver trip rate master rows" })
  listDriverTripRates(@Req() req: any) {
    return this.master.listDriverTripRateMasters(req.tenant.tenantId);
  }

  @Post("driver-trip-rates")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Create tenant-scoped driver trip rate master row" })
  createDriverTripRate(
    @Req() req: any,
    @Body() dto: CreateDriverTripRateMasterDto,
  ) {
    return this.master.createDriverTripRateMaster(req.tenant.tenantId, dto);
  }

  @Patch("driver-trip-rates/:id")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Update tenant-scoped driver trip rate master row" })
  updateDriverTripRate(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateDriverTripRateMasterDto,
  ) {
    return this.master.updateDriverTripRateMaster(req.tenant.tenantId, id, dto);
  }

  @Patch("driver-trip-rates/:id/deactivate")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Deactivate/archive a driver trip rate master row" })
  deactivateDriverTripRate(@Req() req: any, @Param("id") id: string) {
    return this.master.deactivateDriverTripRateMaster(req.tenant.tenantId, id);
  }

  @Post("driver-trip-rates/import")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
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

  @Post("trucking-rates/import/preview")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Preview trucking rates Excel import against the current template (no DB write)",
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
  previewTruckingRates(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    return this.master.previewTruckingRatesImport(req.tenant.tenantId, file);
  }

  @Post("trucking-rates/import")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Import tenant trucking rates dataset from Excel (confirmReplace required when a current template exists)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        confirmReplace: {
          type: "string",
          description: "Set to 'true' to replace an existing current template",
        },
        expectedVersionNo: {
          type: "string",
          description: "Optimistic concurrency: current versionNo expected by the client",
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  importTruckingRates(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body?: { confirmReplace?: string | boolean; expectedVersionNo?: string | number },
  ): Promise<DriverTripRateImportSummaryDto> {
    if (!file) throw new BadRequestException("file is required");
    const confirmReplace =
      body?.confirmReplace === true ||
      String(body?.confirmReplace ?? "").toLowerCase() === "true";
    const expectedRaw = body?.expectedVersionNo;
    const expectedVersionNo =
      expectedRaw === undefined || expectedRaw === null || expectedRaw === ""
        ? null
        : Number(expectedRaw);
    return this.master.importTruckingRatesDataset(
      req.tenant.tenantId,
      file,
      req.user?.userId ?? null,
      {
        confirmReplace,
        expectedVersionNo: Number.isFinite(expectedVersionNo as number)
          ? (expectedVersionNo as number)
          : null,
      },
    );
  }

  @Get("trucking-rates/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List tenant trucking rates dataset rows" })
  listTruckingRateItems(@Req() req: any) {
    return this.master.listDriverTripRateMasters(req.tenant.tenantId);
  }

  @Get("trucking-rates/metadata")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Get tenant trucking rates dataset metadata (uploader/time)" })
  getTruckingRateMetadata(@Req() req: any) {
    return this.master.getDatasetMetadata(
      req.tenant.tenantId,
      MasterRateDatasetType.TRUCKING_RATES,
    );
  }

  @Get("trucking-rates/versions")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List driver payout (trucking) template versions for the tenant" })
  listTruckingRatesVersions(@Req() req: any) {
    return this.master.listTruckingRatesTemplateVersions(req.tenant.tenantId);
  }

  @Post("trucking-rates/versions/:id/restore")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Restore a historical trucking rates template version by copying it into a new current version",
  })
  restoreTruckingRatesVersion(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body?: { expectedVersionNo?: number },
  ) {
    return this.master.restoreTruckingRatesTemplateVersion(
      req.tenant.tenantId,
      id,
      req.user?.userId ?? null,
      body?.expectedVersionNo,
    );
  }

  @Get("trucking-rates/export")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Export the current driver payout (trucking) template items" })
  exportTruckingRatesTemplate(@Req() req: any) {
    return this.master.exportCurrentTruckingRatesTemplate(req.tenant.tenantId);
  }

  @Post("trucking-rates/blank-template")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Create an empty current trucking rates template when none exists (no Excel import)",
  })
  createBlankTruckingRatesTemplate(@Req() req: any) {
    return this.master.createBlankTruckingRatesTemplate(
      req.tenant.tenantId,
      req.user?.userId ?? null,
    );
  }

  @Patch("trucking-rates/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Replace tenant trucking rates dataset rows (creates a new version)" })
  saveTruckingRateItems(
    @Req() req: any,
    @Body() dto: SaveTruckingRatesDatasetDto,
  ) {
    return this.master.replaceDriverTripRateMasters(
      req.tenant.tenantId,
      dto.items ?? [],
      req.user?.userId ?? null,
      dto.expectedVersionNo,
    );
  }

  @Post("dhc-rates/import/preview")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Preview DHC rates Excel import against the current template (no DB write)",
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
  previewDhcRates(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("file is required");
    return this.master.previewDhcRatesImport(req.tenant.tenantId, file);
  }

  @Post("dhc-rates/import")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Import tenant DHC rates dataset from Excel (confirmReplace required when a current template exists)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        confirmReplace: {
          type: "string",
          description: "Set to 'true' to replace an existing current template",
        },
        expectedVersionNo: {
          type: "string",
          description: "Optimistic concurrency: current versionNo expected by the client",
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  importDhcRates(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body?: { confirmReplace?: string | boolean; expectedVersionNo?: string | number },
  ) {
    if (!file) throw new BadRequestException("file is required");
    const confirmReplace =
      body?.confirmReplace === true ||
      String(body?.confirmReplace ?? "").toLowerCase() === "true";
    const expectedRaw = body?.expectedVersionNo;
    const expectedVersionNo =
      expectedRaw === undefined || expectedRaw === null || expectedRaw === ""
        ? null
        : Number(expectedRaw);
    return this.master.importDhcRatesDataset(
      req.tenant.tenantId,
      file,
      req.user?.userId ?? null,
      {
        confirmReplace,
        expectedVersionNo: Number.isFinite(expectedVersionNo as number)
          ? (expectedVersionNo as number)
          : null,
      },
    );
  }

  @Get("dhc-rates/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List tenant DHC rates dataset rows" })
  listDhcRateItems(@Req() req: any) {
    return this.master.listDhcRateDatasetItems(req.tenant.tenantId);
  }

  @Get("dhc-rates/metadata")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Get tenant DHC rates dataset metadata (uploader/time)" })
  getDhcRateMetadata(@Req() req: any) {
    return this.master.getDatasetMetadata(
      req.tenant.tenantId,
      MasterRateDatasetType.DHC_RATES,
    );
  }

  @Get("dhc-rates/versions")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List DHC rates template versions for the tenant" })
  listDhcRatesVersions(@Req() req: any) {
    return this.master.listDhcRatesTemplateVersions(req.tenant.tenantId);
  }

  @Post("dhc-rates/versions/:id/restore")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Restore a historical DHC rates template version by copying it into a new current version",
  })
  restoreDhcRatesVersion(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body?: { expectedVersionNo?: number },
  ) {
    return this.master.restoreDhcRatesTemplateVersion(
      req.tenant.tenantId,
      id,
      req.user?.userId ?? null,
      body?.expectedVersionNo,
    );
  }

  @Get("dhc-rates/export")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Export the current DHC rates template items" })
  exportDhcRatesTemplate(@Req() req: any) {
    return this.master.exportCurrentDhcRatesTemplate(req.tenant.tenantId);
  }

  @Post("dhc-rates/blank-template")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Create an empty current DHC rates template when none exists (no Excel import)",
  })
  createBlankDhcRatesTemplate(@Req() req: any) {
    return this.master.createBlankDhcRatesTemplate(
      req.tenant.tenantId,
      req.user?.userId ?? null,
    );
  }

  @Patch("dhc-rates/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Replace tenant DHC rates dataset rows (creates a new version)" })
  saveDhcRateItems(@Req() req: any, @Body() dto: SaveDhcRatesDatasetDto) {
    return this.master.replaceDhcRatesDataset(
      req.tenant.tenantId,
      dto.items ?? [],
      req.user?.userId ?? null,
      dto.expectedVersionNo,
    );
  }

  @Post("files/:type/upload")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
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

  @Post("quotation/import/preview")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Preview quotation Excel import against the current base template (no DB write)",
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
  previewQuotationImport(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("file is required");
    return this.master.previewQuotationImport(req.tenant.tenantId, file);
  }

  @Post("quotation/import")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Import tenant quotation dataset from Excel (confirmReplace required when a current template exists)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        confirmReplace: {
          type: "string",
          description: "Set to 'true' to replace an existing current template",
        },
        expectedVersionNo: {
          type: "string",
          description: "Optimistic concurrency: current versionNo expected by the client",
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  importQuotationDataset(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body?: { confirmReplace?: string | boolean; expectedVersionNo?: string | number },
  ) {
    if (!file) throw new BadRequestException("file is required");
    const confirmReplace =
      body?.confirmReplace === true ||
      String(body?.confirmReplace ?? "").toLowerCase() === "true";
    const expectedRaw = body?.expectedVersionNo;
    const expectedVersionNo =
      expectedRaw === undefined || expectedRaw === null || expectedRaw === ""
        ? null
        : Number(expectedRaw);
    return this.master.importQuotationDataset(
      req.tenant.tenantId,
      file,
      req.user?.userId ?? null,
      {
        confirmReplace,
        expectedVersionNo: Number.isFinite(expectedVersionNo as number)
          ? (expectedVersionNo as number)
          : null,
      },
    );
  }

  @Get("quotation/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List tenant quotation dataset rows" })
  getQuotationItems(@Req() req: any) {
    return this.master.listQuotationDatasetItems(req.tenant.tenantId);
  }

  @Get("quotation/metadata")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Get tenant quotation dataset metadata (uploader/time)" })
  getQuotationMetadata(@Req() req: any) {
    return this.master.getDatasetMetadata(req.tenant.tenantId, MasterRateDatasetType.QUOTATION);
  }

  @Get("quotation/versions")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List base quotation template versions for the tenant" })
  listQuotationVersions(@Req() req: any) {
    return this.master.listQuotationTemplateVersions(req.tenant.tenantId);
  }

  @Post("quotation/versions/:id/restore")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Restore a historical quotation template version by copying it into a new current version",
  })
  restoreQuotationVersion(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body?: { expectedVersionNo?: number },
  ) {
    return this.master.restoreQuotationTemplateVersion(
      req.tenant.tenantId,
      id,
      req.user?.userId ?? null,
      body?.expectedVersionNo,
    );
  }

  @Get("quotation/export")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Export the current base quotation template items" })
  exportQuotationTemplate(@Req() req: any) {
    return this.master.exportCurrentQuotationTemplate(req.tenant.tenantId);
  }

  @Patch("quotation/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Replace tenant quotation dataset rows (creates a new version)" })
  saveQuotationItems(@Req() req: any, @Body() dto: SaveQuotationDatasetDto) {
    return this.master.replaceQuotationDatasetItems(
      req.tenant.tenantId,
      dto.items ?? [],
      req.user?.userId ?? null,
      dto.expectedVersionNo,
    );
  }

  @Post("quotation/blank-template")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Create an empty current base quotation template when none exists (no Excel import)",
  })
  createBlankQuotationTemplate(@Req() req: any) {
    return this.master.createBlankQuotationTemplate(
      req.tenant.tenantId,
      req.user?.userId ?? null,
    );
  }

  @Get("files")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "List uploaded master files" })
  listMasterFiles(@Req() req: any) {
    return this.master.listMasterFiles(req.tenant.tenantId);
  }

  @Get("files/:type/active/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
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
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({ summary: "Activate a specific master file version" })
  activateMasterFile(@Req() req: any, @Param("id") id: string) {
    return this.master.activateMasterFile(req.tenant.tenantId, id);
  }

  @Post("files/:id/reprocess")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary:
      "Reprocess by downloading stored source file and replacing parsed rows for this master file",
  })
  async reprocessMasterFile(@Req() req: any, @Param("id") id: string) {
    return this.master.reprocessMasterFile(req.tenant.tenantId, id);
  }

  @Patch("files/:id/items")
  @Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
  @ApiOperation({
    summary: "Replace parsed items for a QUOTATION master file version",
  })
  async replaceMasterFileItems(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: SaveMasterQuotationItemsDto,
  ) {
    return this.master.replaceQuotationMasterFileItems(
      req.tenant.tenantId,
      id,
      dto.items ?? [],
    );
  }
}
