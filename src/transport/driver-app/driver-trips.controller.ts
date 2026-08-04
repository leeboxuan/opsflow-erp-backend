import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { TenantModule } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

@ApiTags("driver-trips")
@Controller("drivers/trips")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.DRIVER)
@ApiBearerAuth("JWT-auth")
export class DriverTripsController {
  constructor(private readonly driverJobs: DriverJobsService) {}

  @Get(":tripId")
  @ApiOperation({ summary: "Get driver-scoped trip execution detail by trip id" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        jobId: { type: "string", nullable: true },
        tripDisplayRef: { type: "string", nullable: true },
        title: { type: "string", nullable: true },
        status: { type: "string" },
        plannedStartAt: { type: "string", format: "date-time", nullable: true },
        jobSequence: { type: "number", nullable: true },
        tripSequence: { type: "number", nullable: true },
        origin: { type: "string", nullable: true },
        destination: { type: "string", nullable: true },
        documents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              status: { type: "string" },
              label: { type: "string" },
              fileName: { type: "string" },
              originalFileName: { type: "string", nullable: true },
              mimeType: { type: "string", nullable: true },
              fileSizeBytes: { type: "integer", nullable: true },
              fileUrl: { type: "string", nullable: true },
              uploadedAt: { type: "string", format: "date-time" },
              signedAt: { type: "string", format: "date-time", nullable: true },
              uploadedByUserId: { type: "string", nullable: true },
              uploadedByName: { type: "string", nullable: true },
              uploadedByCurrentDriver: { type: "boolean" },
              canDelete: { type: "boolean" },
            },
          },
        },
      },
    },
  })
  async getTrip(@Req() req: any, @Param("tripId") tripId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getTripDetailForDriver(tenantId, tripId, userId);
  }

  @Get(":tripId/documents/:documentId/signed-url")
  @ApiOperation({ summary: "Get signed preview/download URLs for a trip document (driver)" })
  async getTripDocumentSignedUrl(
    @Req() req: any,
    @Param("tripId") tripId: string,
    @Param("documentId") documentId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getDriverTripDocumentSignedUrl(
      tenantId,
      tripId,
      documentId,
      userId,
    );
  }
}
