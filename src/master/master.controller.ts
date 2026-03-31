import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { MasterDataService } from "./master.service";

@ApiTags("master-data")
@Controller("master")
@UseGuards(AuthGuard, TenantGuard)
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
}
