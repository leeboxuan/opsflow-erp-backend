import { Module } from "@nestjs/common";
import { AuthModule } from "../shared/auth/auth.module";
import { PrismaModule } from "../shared/prisma/prisma.module";
import { AdminModule } from "../admin/admin.module";
import { PlatformController } from "./platform.controller";
import { PlatformBootstrapController } from "./platform-bootstrap.controller";
import { PlatformService } from "./platform.service";
import { PlatformBootstrapService } from "./platform-bootstrap.service";
import { PlatformAuditService } from "./platform-audit.service";

@Module({
  imports: [PrismaModule, AuthModule, AdminModule],
  controllers: [PlatformController, PlatformBootstrapController],
  providers: [PlatformService, PlatformBootstrapService, PlatformAuditService],
  exports: [PlatformService, PlatformAuditService],
})
export class PlatformModule {}
