import { Body, Controller, Get, Post, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { PlatformBootstrapService } from "./platform-bootstrap.service";
import { PlatformBootstrapSetupDto } from "./dto/platform-bootstrap.dto";

/**
 * First Platform Admin bootstrap. Intentionally NOT behind PlatformAdminGuard
 * (chicken-and-egg). Gated by env + empty platform_admins table.
 */
@ApiTags("platform-bootstrap")
@Controller("platform/bootstrap")
export class PlatformBootstrapController {
  constructor(private readonly bootstrap: PlatformBootstrapService) {}

  @Get("status")
  @ApiOperation({
    summary: "Whether first Platform Admin setup is available",
  })
  getStatus() {
    return this.bootstrap.getStatus();
  }

  @Post()
  @ApiOperation({
    summary: "One-time Platform Super Admin setup (empty platform only)",
  })
  setup(@Body() dto: PlatformBootstrapSetupDto) {
    return this.bootstrap.setup(dto);
  }

  @Post("claim")
  @ApiBearerAuth("JWT-auth")
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "Claim Platform Super Admin with an existing authenticated account",
  })
  claim(@Request() req: { user: { userId: string; email: string } }) {
    return this.bootstrap.claim({
      userId: req.user.userId,
      email: req.user.email,
    });
  }
}
