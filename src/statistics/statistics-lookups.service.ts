import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  StatisticsLookupItemDto,
  StatisticsLookupSelectedQueryDto,
  StatisticsLookupsDto,
  StatisticsLookupsQueryDto,
} from "./dto";
import {
  displayJobNo,
  displayPersonName,
  displayTripReference,
  displayVehiclePlate,
} from "./statistics-references";

const LOOKUP_LIMIT = 20;

@Injectable()
export class StatisticsLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    tenantId: string,
    query: StatisticsLookupsQueryDto,
  ): Promise<StatisticsLookupsDto> {
    const q = query.q?.trim() ?? "";
    switch (query.entity) {
      case "customers":
        return { data: await this.searchCustomers(tenantId, q) };
      case "jobs":
        return { data: await this.searchJobs(tenantId, q) };
      case "trips":
        return { data: await this.searchTrips(tenantId, q) };
      case "drivers":
        return { data: await this.searchDrivers(tenantId, q) };
      case "vehicles":
        return { data: await this.searchVehicles(tenantId, q) };
      case "containers":
        return { data: await this.searchContainers(tenantId, q) };
      default:
        return { data: [] };
    }
  }

  async selected(
    tenantId: string,
    query: StatisticsLookupSelectedQueryDto,
  ): Promise<StatisticsLookupsDto> {
    const data: StatisticsLookupItemDto[] = [];
    if (query.customerId) {
      const company = await this.prisma.customer_companies.findFirst({
        where: { tenantId, id: query.customerId },
        select: { id: true, name: true },
      });
      if (company) {
        data.push({ id: company.id, label: company.name, sublabel: "Customer" });
      }
    }
    if (query.jobId) {
      const job = await this.prisma.job.findFirst({
        where: { tenantId, id: query.jobId },
        select: { id: true, internalRef: true, jobType: true },
      });
      if (job) {
        data.push({
          id: job.id,
          label: displayJobNo(job.internalRef),
          sublabel: job.jobType,
        });
      }
    }
    if (query.tripId) {
      const trip = await this.prisma.trip.findFirst({
        where: { tenantId, id: query.tripId, jobId: { not: null } },
        select: {
          id: true,
          jobSequence: true,
          tripSequence: true,
          job: { select: { internalRef: true } },
        },
      });
      if (trip) {
        data.push({
          id: trip.id,
          label: displayTripReference({
            jobNo: trip.job?.internalRef,
            jobSequence: trip.jobSequence,
            tripSequence: trip.tripSequence,
          }),
          sublabel: "Trip",
        });
      }
    }
    if (query.driverId) {
      const driver = await this.prisma.drivers.findFirst({
        where: { tenantId, userId: query.driverId },
        select: { userId: true, name: true },
      });
      if (driver?.userId) {
        data.push({
          id: driver.userId,
          label: displayPersonName(driver.name) ?? "Unnamed driver",
          sublabel: "Driver",
        });
      }
    }
    if (query.containerNo) {
      data.push({
        id: query.containerNo,
        label: query.containerNo,
        sublabel: "Container",
      });
    }
    if (query.vehicleId) {
      const [fleet, vehicle] = await Promise.all([
        this.prisma.fleetVehicle.findFirst({
          where: { tenantId, id: query.vehicleId },
          select: { id: true, plateNo: true, type: true },
        }),
        this.prisma.vehicle.findFirst({
          where: { tenantId, id: query.vehicleId },
          select: { id: true, plateNo: true, type: true },
        }),
      ]);
      const match = fleet ?? vehicle;
      if (match) {
        data.push({
          id: match.id,
          label: match.plateNo,
          sublabel: match.type,
        });
      }
    }
    return { data };
  }

  private async searchCustomers(tenantId: string, q: string) {
    const rows = await this.prisma.customer_companies.findMany({
      where: {
        tenantId,
        ...(q
          ? { name: { contains: q, mode: "insensitive" } }
          : {}),
      },
      orderBy: { name: "asc" },
      take: LOOKUP_LIMIT,
      select: { id: true, name: true },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.name,
      sublabel: null,
    }));
  }

  private async searchJobs(tenantId: string, q: string) {
    const rows = await this.prisma.job.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { internalRef: { contains: q, mode: "insensitive" } },
                { externalRef: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { internalRef: "desc" },
      take: LOOKUP_LIMIT,
      select: {
        id: true,
        internalRef: true,
        jobType: true,
        customerCompany: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      label: displayJobNo(row.internalRef),
      sublabel: `${row.jobType} · ${row.customerCompany.name}`,
    }));
  }

  private async searchTrips(tenantId: string, q: string) {
    const rows = await this.prisma.trip.findMany({
      where: {
        tenantId,
        jobId: { not: null },
        ...(q
          ? {
              job: {
                is: {
                  tenantId,
                  internalRef: { contains: q, mode: "insensitive" },
                },
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: LOOKUP_LIMIT,
      select: {
        id: true,
        jobSequence: true,
        tripSequence: true,
        job: { select: { internalRef: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      label: displayTripReference({
        jobNo: row.job?.internalRef,
        jobSequence: row.jobSequence,
        tripSequence: row.tripSequence,
      }),
      sublabel: null,
    }));
  }

  private async searchDrivers(tenantId: string, q: string) {
    const rows = await this.prisma.drivers.findMany({
      where: {
        tenantId,
        userId: { not: null },
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      take: LOOKUP_LIMIT,
      select: { userId: true, name: true },
    });
    return rows
      .filter((row): row is { userId: string; name: string | null } => !!row.userId)
      .map((row) => ({
        id: row.userId,
        label: displayPersonName(row.name) ?? "Unnamed driver",
        sublabel: null,
      }));
  }

  private async searchVehicles(tenantId: string, q: string) {
    const where: Prisma.VehicleWhereInput = {
      tenantId,
      ...(q ? { plateNo: { contains: q, mode: "insensitive" } } : {}),
    };
    const [fleet, vehicles] = await Promise.all([
      this.prisma.fleetVehicle.findMany({
        where,
        orderBy: { plateNo: "asc" },
        take: LOOKUP_LIMIT,
        select: { id: true, plateNo: true, type: true },
      }),
      this.prisma.vehicle.findMany({
        where,
        orderBy: { plateNo: "asc" },
        take: LOOKUP_LIMIT,
        select: { id: true, plateNo: true, type: true },
      }),
    ]);
    const merged = [...fleet, ...vehicles]
      .sort((left, right) => left.plateNo.localeCompare(right.plateNo))
      .slice(0, LOOKUP_LIMIT);
    return merged.map((row) => ({
      id: row.id,
      label: displayVehiclePlate(row.plateNo, null, null),
      sublabel: row.type,
    }));
  }

  private async searchContainers(tenantId: string, q: string) {
    const rows = await this.prisma.jobItem.findMany({
      where: {
        tenantId,
        ...(q ? { itemCode: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { itemCode: "asc" },
      take: LOOKUP_LIMIT,
      distinct: ["itemCode"],
      select: { itemCode: true },
    });
    return rows.map((row) => ({
      id: row.itemCode,
      label: row.itemCode,
      sublabel: "Container",
    }));
  }
}
