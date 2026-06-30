import { Module } from "@nestjs/common";
import { PrismaModule } from "../shared/prisma/prisma.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { AuthModule } from "@/shared/auth/auth.module";

@Module({
    imports: [PrismaModule, AuthModule], // ✅ AuthModule is the key fix
    controllers: [DashboardController],
    providers: [DashboardService],
})
export class DashboardModule { }
