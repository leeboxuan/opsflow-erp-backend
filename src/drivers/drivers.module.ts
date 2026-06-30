import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../shared/users/users.module";

import { DriversController } from "./drivers.controller";
import { AdminDriversController } from "./admin-drivers.controller";
import { AdminDriversService } from "./admin-drivers.service";

@Module({
  imports: [PrismaModule, AuthModule, UsersModule],
  controllers: [DriversController, AdminDriversController],
  providers: [AdminDriversService],
})
export class DriversModule {}