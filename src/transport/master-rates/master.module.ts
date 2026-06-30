import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";
import { MasterDataController } from "./master.controller";
import { MasterDataService } from "./master.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterModule {}
