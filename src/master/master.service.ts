import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

  listSingaporePorts() {
    return this.prisma.masterSingaporePort.findMany({
      orderBy: { code: "asc" },
    });
  }

  listSingaporeDepots() {
    return this.prisma.masterSingaporeDepot.findMany({
      orderBy: { code: "asc" },
    });
  }

  listTrailerLocations() {
    return this.prisma.masterTrailerLocation.findMany({
      orderBy: { code: "asc" },
    });
  }
}
