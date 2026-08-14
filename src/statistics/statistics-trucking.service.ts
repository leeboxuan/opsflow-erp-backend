import { Injectable } from "@nestjs/common";
import { JobType, Prisma, TripStatus, VehicleType } from "@prisma/client";
import {
  buildPaginationMeta,
  parsePaginationFromQuery,
} from "../shared/common/pagination";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  StatisticsContainerMovementRowDto,
  StatisticsContainerRowDto,
  StatisticsContainersDto,
  StatisticsContainerMovementsDto,
  StatisticsFiltersQueryDto,
  StatisticsFleetDto,
  StatisticsFleetRowDto,
  StatisticsLaneRowDto,
  StatisticsLanesDto,
  StatisticsTrailerRowDto,
  StatisticsTruckingContainersQueryDto,
  StatisticsTruckingFleetQueryDto,
  StatisticsTruckingLanesQueryDto,
  StatisticsTruckingMovementsQueryDto,
  StatisticsTruckingSummaryDto,
  StatisticsTruckingSummaryQueryDto,
} from "./dto";
import {
  COMPLETED_TRIP_STATUSES,
  STATISTICS_FLEET_LIMITATIONS,
  STATISTICS_TRUCKING_LIMITATIONS,
} from "./statistics.constants";
import { resolveStatisticsDateRange } from "./statistics-date-range";
import {
  calendarDateKey,
  displayContainerNo,
  displayJobNo,
  displayJobType,
  displayLaneEndpoint,
  displayPersonName,
  displayTrailerNo,
  displayTripReference,
  displayTripStatus,
  displayVehiclePlate,
  inferContainerSizeLabel,
} from "./statistics-references";
import {
  buildContainerMovementWhere,
  buildStatisticsTripScope,
} from "./statistics-scope";
import {
  evaluateRequiredDocumentCompletion,
  hasResolvableRequiredDocumentRule,
  resolveTripDuration,
} from "./statistics.predicates";
import { loadTripDocumentRequirementSnapshotsByTrip } from "../transport/workflows/trip-document-requirements";

export const TRUCKING_BATCH_SIZE = 200;

export type CompactMovement = {
  movementId: string;
  jobItemId: string;
  containerNo: string;
  containerSize: string;
  jobId: string;
  jobNo: string;
  jobType: JobType;
  customerId: string;
  customerName: string;
  tripId: string;
  jobSequence: number | null;
  tripSequence: number | null;
  originLabel: string | null;
  destinationLabel: string | null;
  driverUserId: string | null;
  vehicleKey: string;
  vehiclePlate: string;
  vehicleType: string | null;
  trailerNo: string | null;
  tripStatus: TripStatus;
  startedAt: Date | null;
  closedAt: Date;
  durationMs: number | null;
};

type MovementRecord = {
  id: string;
  jobItemId: string;
  containerNumberSnapshot: string | null;
  jobItem: {
    itemCode: string;
    description: string | null;
  };
  trip: {
    id: string;
    jobId: string | null;
    jobSequence: number | null;
    tripSequence: number | null;
    status: TripStatus;
    startedAt: Date | null;
    closedAt: Date | null;
    originLabel: string | null;
    destinationLabel: string | null;
    assignedDriverUserId: string | null;
    vehicleId: string | null;
    fleetVehicleId: string | null;
    acceptedVehicleNo: string | null;
    trailerNumber: string | null;
    acceptedTrailerNo: string | null;
    completionRuleJson: Prisma.JsonValue | null;
    job: {
      id: string;
      internalRef: string;
      jobType: JobType;
      customerCompanyId: string;
      customerCompany: { name: string };
    } | null;
    fleetVehicle: { id: string; plateNo: string; type: VehicleType } | null;
    vehicles: { id: string; plateNo: string; type: VehicleType } | null;
  };
};

const MOVEMENT_SELECT = {
  id: true,
  jobItemId: true,
  containerNumberSnapshot: true,
  jobItem: {
    select: {
      itemCode: true,
      description: true,
    },
  },
  trip: {
    select: {
      id: true,
      jobId: true,
      jobSequence: true,
      tripSequence: true,
      status: true,
      startedAt: true,
      closedAt: true,
      originLabel: true,
      destinationLabel: true,
      assignedDriverUserId: true,
      vehicleId: true,
      fleetVehicleId: true,
      acceptedVehicleNo: true,
      trailerNumber: true,
      acceptedTrailerNo: true,
      completionRuleJson: true,
      job: {
        select: {
          id: true,
          internalRef: true,
          jobType: true,
          customerCompanyId: true,
          customerCompany: { select: { name: true } },
        },
      },
      fleetVehicle: { select: { id: true, plateNo: true, type: true } },
      vehicles: { select: { id: true, plateNo: true, type: true } },
    },
  },
} satisfies Prisma.TripJobItemSelect;

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

@Injectable()
export class StatisticsTruckingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    tenantId: string,
    query: StatisticsTruckingSummaryQueryDto,
  ): Promise<StatisticsTruckingSummaryDto> {
    const { range, timeZone } = await this.resolveRange(tenantId, query);
    const tripScope = buildStatisticsTripScope(tenantId, query);
    const [movements, completedTrips, cancelledTrips, durationRows] =
      await Promise.all([
        this.loadCompactMovements(tenantId, query, range),
        this.prisma.trip.count({
          where: {
            ...tripScope,
            status: { in: [...COMPLETED_TRIP_STATUSES] },
            closedAt: { gte: range.gte, lt: range.lt },
          },
        }),
        this.prisma.trip.count({
          where: {
            ...tripScope,
            status: TripStatus.CANCELLED,
            updatedAt: { gte: range.gte, lt: range.lt },
          },
        }),
        this.prisma.trip.findMany({
          where: {
            ...tripScope,
            status: { in: [...COMPLETED_TRIP_STATUSES] },
            closedAt: { gte: range.gte, lt: range.lt },
          },
          select: { startedAt: true, closedAt: true },
        }),
      ]);

    const uniqueJobItems = new Set(movements.map((row) => row.jobItemId));
    const driversByContainer = new Map<string, Set<string>>();
    const jobs = new Set<string>();
    const containersByJobType = new Map<JobType, Set<string>>();
    const sizeMix = new Map<string, Set<string>>();
    const jobTypeMix = new Map<string, Set<string>>();

    for (const row of movements) {
      jobs.add(row.jobId);
      const drivers = driversByContainer.get(row.jobItemId) ?? new Set();
      if (row.driverUserId) drivers.add(row.driverUserId);
      driversByContainer.set(row.jobItemId, drivers);
      const typeSet = containersByJobType.get(row.jobType) ?? new Set();
      typeSet.add(row.jobItemId);
      containersByJobType.set(row.jobType, typeSet);
      const sizeSet = sizeMix.get(row.containerSize) ?? new Set();
      sizeSet.add(row.jobItemId);
      sizeMix.set(row.containerSize, sizeSet);
      const jobTypeSet = jobTypeMix.get(row.jobType) ?? new Set();
      jobTypeSet.add(row.jobId);
      jobTypeMix.set(row.jobType, jobTypeSet);
    }

    let containersHandledByMultipleDrivers = 0;
    for (const drivers of driversByContainer.values()) {
      if (drivers.size > 1) containersHandledByMultipleDrivers += 1;
    }

    const validDurations = (durationRows as Array<{ startedAt: Date | null; closedAt: Date | null }>)
      .map((trip) => resolveTripDuration(trip))
      .filter((result) => result.valid)
      .map((result) => result.durationMs);

    const uniqueContainers = uniqueJobItems.size;
    return {
      timeZone,
      generatedAt: new Date(),
      limitations: [...STATISTICS_TRUCKING_LIMITATIONS],
      uniqueContainers,
      containerMovements: movements.length,
      averageMovementsPerContainer:
        uniqueContainers > 0
          ? Math.round((movements.length / uniqueContainers) * 100) / 100
          : null,
      containersHandledByMultipleDrivers,
      jobs: jobs.size,
      completedTrips,
      cancelledTrips,
      avgTripDurationMs: average(validDurations),
      importContainers: containersByJobType.get(JobType.IMPORT)?.size ?? 0,
      exportContainers: containersByJobType.get(JobType.EXPORT)?.size ?? 0,
      lclContainers: containersByJobType.get(JobType.LCL)?.size ?? 0,
      collectionContainers:
        containersByJobType.get(JobType.COLLECTION)?.size ?? 0,
      containerSizeMix: Array.from(sizeMix, ([label, set]) => ({
        label,
        count: set.size,
      })).sort((a, b) => b.count - a.count || compareText(a.label, b.label)),
      jobTypeMix: Array.from(jobTypeMix, ([label, set]) => ({
        label,
        count: set.size,
      })).sort((a, b) => b.count - a.count || compareText(a.label, b.label)),
    };
  }

  async getMovements(
    tenantId: string,
    query: StatisticsTruckingMovementsQueryDto,
  ): Promise<StatisticsContainerMovementsDto> {
    const { range, timeZone } = await this.resolveRange(tenantId, query);
    const pagination = parsePaginationFromQuery(query);
    const where = buildContainerMovementWhere(tenantId, query, range);
    const sortBy = query.sortBy === "containerNo" ? "containerNo" : "movementDate";
    const sortDir = query.sortDir === "desc" ? "desc" : "asc";
    const orderBy: Prisma.TripJobItemOrderByWithRelationInput[] =
      sortBy === "containerNo"
        ? [
            { jobItem: { itemCode: sortDir } },
            { trip: { closedAt: sortDir } },
            { id: "asc" },
          ]
        : [{ trip: { closedAt: sortDir } }, { id: "asc" }];

    const [total, rows] = await Promise.all([
      this.prisma.tripJobItem.count({ where }),
      this.prisma.tripJobItem.findMany({
        where,
        orderBy,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        select: MOVEMENT_SELECT,
      }),
    ]);

    const mapped = (rows as MovementRecord[])
      .map((row) => this.toCompact(row))
      .filter((row): row is CompactMovement => row != null);
    const names = await this.driverNames(
      tenantId,
      mapped.map((row) => row.driverUserId),
    );
    const documentation = await this.documentationByTrip(
      tenantId,
      mapped.map((row) => row.tripId),
      rows as MovementRecord[],
    );

    return {
      timeZone,
      generatedAt: new Date(),
      limitations: [...STATISTICS_TRUCKING_LIMITATIONS],
      data: mapped.map((row) => this.toMovementRow(row, names, documentation)),
      meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
    };
  }

  async getAllMovements(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsContainerMovementRowDto[]> {
    const { range } = await this.resolveRange(tenantId, query);
    const compact = await this.loadCompactMovements(tenantId, query, range);
    compact.sort((left, right) => {
      const byDate = left.closedAt.getTime() - right.closedAt.getTime();
      return byDate !== 0 ? byDate : left.movementId.localeCompare(right.movementId);
    });
    const names = await this.driverNames(
      tenantId,
      compact.map((row) => row.driverUserId),
    );
    return compact.map((row) =>
      this.toMovementRow(row, names, new Map()),
    );
  }

  async getContainers(
    tenantId: string,
    query: StatisticsTruckingContainersQueryDto,
  ): Promise<StatisticsContainersDto> {
    const { range, timeZone } = await this.resolveRange(tenantId, query);
    const pagination = parsePaginationFromQuery(query);
    const rows = await this.buildContainerRows(tenantId, query, range);
    const page = rows.slice(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize,
    );
    return {
      timeZone,
      generatedAt: new Date(),
      limitations: [...STATISTICS_TRUCKING_LIMITATIONS],
      data: page,
      meta: buildPaginationMeta(pagination.page, pagination.pageSize, rows.length),
    };
  }

  async getAllContainers(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsContainerRowDto[]> {
    const { range } = await this.resolveRange(tenantId, query);
    return this.buildContainerRows(tenantId, query, range);
  }

  async getLanes(
    tenantId: string,
    query: StatisticsTruckingLanesQueryDto,
  ): Promise<StatisticsLanesDto> {
    const { range, timeZone } = await this.resolveRange(tenantId, query);
    const pagination = parsePaginationFromQuery(query);
    const rows = await this.buildLaneRows(tenantId, query, range);
    const page = rows.slice(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize,
    );
    return {
      timeZone,
      generatedAt: new Date(),
      limitations: [...STATISTICS_TRUCKING_LIMITATIONS],
      data: page,
      meta: buildPaginationMeta(pagination.page, pagination.pageSize, rows.length),
    };
  }

  async getAllLanes(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsLaneRowDto[]> {
    const { range } = await this.resolveRange(tenantId, query);
    return this.buildLaneRows(tenantId, query, range);
  }

  async getFleet(
    tenantId: string,
    query: StatisticsTruckingFleetQueryDto,
  ): Promise<StatisticsFleetDto> {
    const { range, timeZone } = await this.resolveRange(tenantId, query);
    const pagination = parsePaginationFromQuery(query);
    const { vehicles, trailers } = await this.buildFleetRows(
      tenantId,
      query,
      range,
      timeZone,
    );
    const page = vehicles.slice(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize,
    );
    return {
      timeZone,
      generatedAt: new Date(),
      limitations: [
        ...STATISTICS_TRUCKING_LIMITATIONS,
        ...STATISTICS_FLEET_LIMITATIONS,
      ],
      data: page,
      trailers,
      meta: buildPaginationMeta(
        pagination.page,
        pagination.pageSize,
        vehicles.length,
      ),
    };
  }

  async getAllFleet(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<{ vehicles: StatisticsFleetRowDto[]; trailers: StatisticsTrailerRowDto[] }> {
    const { range, timeZone } = await this.resolveRange(tenantId, query);
    return this.buildFleetRows(tenantId, query, range, timeZone);
  }

  async loadCompactMovements(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
  ): Promise<CompactMovement[]> {
    const where = buildContainerMovementWhere(tenantId, query, range);
    const facts: CompactMovement[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = (await this.prisma.tripJobItem.findMany({
        where,
        orderBy: { id: "asc" },
        take: TRUCKING_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: MOVEMENT_SELECT,
      })) as MovementRecord[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const compact = this.toCompact(row);
        if (compact) facts.push(compact);
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < TRUCKING_BATCH_SIZE) break;
    }
    return facts;
  }

  private async buildContainerRows(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
  ): Promise<StatisticsContainerRowDto[]> {
    const movements = await this.loadCompactMovements(tenantId, query, range);
    const names = await this.driverNames(
      tenantId,
      movements.map((row) => row.driverUserId),
    );
    const byItem = new Map<string, CompactMovement[]>();
    for (const row of movements) {
      const list = byItem.get(row.jobItemId) ?? [];
      list.push(row);
      byItem.set(row.jobItemId, list);
    }
    const rows: StatisticsContainerRowDto[] = [];
    for (const [jobItemId, list] of byItem) {
      list.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
      const first = list[0];
      const last = list[list.length - 1];
      const driverIds = uniqueSorted(
        list
          .map((row) => row.driverUserId)
          .filter((id): id is string => typeof id === "string"),
      );
      const plates = uniqueSorted(
        list
          .map((row) => row.vehiclePlate)
          .filter((plate) => plate !== "Unassigned"),
      );
      const durations = list
        .map((row) => row.durationMs)
        .filter((value): value is number => value != null);
      rows.push({
        containerKey: jobItemId,
        containerNo: first.containerNo,
        customers: uniqueSorted(list.map((row) => row.customerName)).join(", ") || "—",
        jobs: uniqueSorted(list.map((row) => row.jobNo)).join(", ") || "—",
        jobType: uniqueSorted(list.map((row) => displayJobType(row.jobType))).join(", "),
        containerSize: first.containerSize,
        movements: list.length,
        driversTouched: driverIds.length,
        driverNames:
          driverIds
            .map((id) => names.get(id) ?? "Unnamed driver")
            .join(", ") || "—",
        vehiclesUsed: plates.length,
        vehiclePlates: plates.join(", ") || "—",
        firstMovementAt: first.closedAt,
        lastMovementAt: last.closedAt,
        firstOrigin: displayLaneEndpoint(first.originLabel, "origin"),
        finalDestination: displayLaneEndpoint(last.destinationLabel, "destination"),
        totalDurationMs: durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) : null,
        avgDurationMs: average(durations),
      });
    }
    rows.sort((left, right) => {
      const byContainer = compareText(left.containerNo, right.containerNo);
      if (byContainer !== 0) return byContainer;
      return left.containerKey.localeCompare(right.containerKey);
    });
    return rows;
  }

  private async buildLaneRows(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
  ): Promise<StatisticsLaneRowDto[]> {
    const movements = await this.loadCompactMovements(tenantId, query, range);
    const cancelled = (await this.prisma.trip.findMany({
      where: {
        ...buildStatisticsTripScope(tenantId, query),
        status: TripStatus.CANCELLED,
        updatedAt: { gte: range.gte, lt: range.lt },
      },
      select: { originLabel: true, destinationLabel: true },
    })) as Array<{ originLabel: string | null; destinationLabel: string | null }>;

    type LaneAgg = {
      origin: string;
      destination: string;
      movements: number;
      containers: Set<string>;
      jobs: Set<string>;
      trips: Set<string>;
      drivers: Set<string>;
      vehicles: Set<string>;
      durations: number[];
      cancelledTrips: number;
    };
    const lanes = new Map<string, LaneAgg>();
    const ensure = (originLabel: string | null, destinationLabel: string | null) => {
      const origin = displayLaneEndpoint(originLabel, "origin");
      const destination = displayLaneEndpoint(destinationLabel, "destination");
      const key = `${origin}\u0000${destination}`;
      const existing = lanes.get(key);
      if (existing) return existing;
      const created: LaneAgg = {
        origin,
        destination,
        movements: 0,
        containers: new Set(),
        jobs: new Set(),
        trips: new Set(),
        drivers: new Set(),
        vehicles: new Set(),
        durations: [],
        cancelledTrips: 0,
      };
      lanes.set(key, created);
      return created;
    };

    for (const row of movements) {
      const lane = ensure(row.originLabel, row.destinationLabel);
      lane.movements += 1;
      lane.containers.add(row.jobItemId);
      lane.jobs.add(row.jobId);
      lane.trips.add(row.tripId);
      if (row.driverUserId) lane.drivers.add(row.driverUserId);
      if (row.vehiclePlate !== "Unassigned") lane.vehicles.add(row.vehiclePlate);
      if (row.durationMs != null) lane.durations.push(row.durationMs);
    }
    for (const trip of cancelled) {
      ensure(trip.originLabel, trip.destinationLabel).cancelledTrips += 1;
    }

    return Array.from(lanes.values())
      .map((lane) => ({
        lane: `${lane.origin} → ${lane.destination}`,
        origin: lane.origin,
        destination: lane.destination,
        movements: lane.movements,
        uniqueContainers: lane.containers.size,
        uniqueJobs: lane.jobs.size,
        avgDurationMs: average(lane.durations),
        driversUsed: lane.drivers.size,
        vehiclesUsed: lane.vehicles.size,
        completedTrips: lane.trips.size,
        cancelledTrips: lane.cancelledTrips,
      }))
      .sort((left, right) => right.movements - left.movements || compareText(left.lane, right.lane));
  }

  private async buildFleetRows(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
    timeZone: string,
  ): Promise<{ vehicles: StatisticsFleetRowDto[]; trailers: StatisticsTrailerRowDto[] }> {
    const movements = await this.loadCompactMovements(tenantId, query, range);
    const names = await this.driverNames(
      tenantId,
      movements.map((row) => row.driverUserId),
    );
    const tripScope = buildStatisticsTripScope(tenantId, query);
    const [completedTrips, cancelledTrips] = await Promise.all([
      this.prisma.trip.findMany({
        where: {
          ...tripScope,
          status: { in: [...COMPLETED_TRIP_STATUSES] },
          closedAt: { gte: range.gte, lt: range.lt },
        },
        select: {
          id: true,
          closedAt: true,
          startedAt: true,
          assignedDriverUserId: true,
          vehicleId: true,
          fleetVehicleId: true,
          acceptedVehicleNo: true,
          fleetVehicle: { select: { id: true, plateNo: true, type: true } },
          vehicles: { select: { id: true, plateNo: true, type: true } },
        },
      }),
      this.prisma.trip.findMany({
        where: {
          ...tripScope,
          status: TripStatus.CANCELLED,
          updatedAt: { gte: range.gte, lt: range.lt },
        },
        select: {
          vehicleId: true,
          fleetVehicleId: true,
          acceptedVehicleNo: true,
          fleetVehicle: { select: { plateNo: true } },
          vehicles: { select: { plateNo: true } },
        },
      }),
    ]);

    type FleetAgg = {
      vehicleKey: string;
      plateNo: string;
      vehicleType: string | null;
      trips: Set<string>;
      movements: number;
      containers: Set<string>;
      days: Set<string>;
      drivers: Set<string>;
      durations: number[];
      cancelledTrips: number;
      lastActivityAt: Date | null;
    };
    const fleet = new Map<string, FleetAgg>();
    const ensureVehicle = (input: {
      key: string;
      plate: string;
      type: string | null;
    }) => {
      const existing = fleet.get(input.key);
      if (existing) return existing;
      const created: FleetAgg = {
        vehicleKey: input.key,
        plateNo: input.plate,
        vehicleType: input.type,
        trips: new Set(),
        movements: 0,
        containers: new Set(),
        days: new Set(),
        drivers: new Set(),
        durations: [],
        cancelledTrips: 0,
        lastActivityAt: null,
      };
      fleet.set(input.key, created);
      return created;
    };

    for (const trip of completedTrips as Array<{
      id: string;
      closedAt: Date | null;
      startedAt: Date | null;
      assignedDriverUserId: string | null;
      vehicleId: string | null;
      fleetVehicleId: string | null;
      acceptedVehicleNo: string | null;
      fleetVehicle: { id: string; plateNo: string; type: VehicleType } | null;
      vehicles: { id: string; plateNo: string; type: VehicleType } | null;
    }>) {
      const key = trip.fleetVehicleId ?? trip.vehicleId ?? `plate:${trip.acceptedVehicleNo ?? "unassigned"}`;
      const plate = displayVehiclePlate(
        trip.fleetVehicle?.plateNo,
        trip.vehicles?.plateNo,
        trip.acceptedVehicleNo,
      );
      const row = ensureVehicle({
        key,
        plate,
        type: trip.fleetVehicle?.type ?? trip.vehicles?.type ?? null,
      });
      row.trips.add(trip.id);
      if (trip.closedAt) {
        row.days.add(calendarDateKey(trip.closedAt, timeZone));
        if (!row.lastActivityAt || trip.closedAt > row.lastActivityAt) {
          row.lastActivityAt = trip.closedAt;
        }
      }
      if (trip.assignedDriverUserId) row.drivers.add(trip.assignedDriverUserId);
      const duration = resolveTripDuration(trip);
      if (duration.valid) row.durations.push(duration.durationMs);
    }

    for (const row of movements) {
      const vehicle = fleet.get(row.vehicleKey) ?? ensureVehicle({
        key: row.vehicleKey,
        plate: row.vehiclePlate,
        type: row.vehicleType,
      });
      vehicle.movements += 1;
      vehicle.containers.add(row.jobItemId);
    }

    for (const trip of cancelledTrips as Array<{
      vehicleId: string | null;
      fleetVehicleId: string | null;
      acceptedVehicleNo: string | null;
      fleetVehicle: { plateNo: string } | null;
      vehicles: { plateNo: string } | null;
    }>) {
      const key = trip.fleetVehicleId ?? trip.vehicleId ?? `plate:${trip.acceptedVehicleNo ?? "unassigned"}`;
      const plate = displayVehiclePlate(
        trip.fleetVehicle?.plateNo,
        trip.vehicles?.plateNo,
        trip.acceptedVehicleNo,
      );
      ensureVehicle({ key, plate, type: null }).cancelledTrips += 1;
    }

    const vehicles: StatisticsFleetRowDto[] = Array.from(fleet.values())
      .filter((row) => row.plateNo !== "Unassigned" || row.trips.size > 0 || row.movements > 0)
      .map((row) => ({
        vehicleKey: row.vehicleKey,
        plateNo: row.plateNo,
        vehicleType: row.vehicleType,
        completedTrips: row.trips.size,
        containerMovements: row.movements,
        uniqueContainers: row.containers.size,
        activeDays: row.days.size,
        drivers:
          uniqueSorted(
            Array.from(row.drivers).map((id) => names.get(id) ?? "Unnamed driver"),
          ).join(", ") || "—",
        avgTripsPerActiveDay:
          row.days.size > 0
            ? Math.round((row.trips.size / row.days.size) * 100) / 100
            : null,
        avgTripDurationMs: average(row.durations),
        cancelledTrips: row.cancelledTrips,
        lastActivityAt: row.lastActivityAt,
      }))
      .sort((left, right) => right.completedTrips - left.completedTrips || compareText(left.plateNo, right.plateNo));

    const trailerMap = new Map<string, { movements: number; containers: Set<string>; drivers: Set<string> }>();
    for (const row of movements) {
      if (!row.trailerNo) continue;
      const trailer = trailerMap.get(row.trailerNo) ?? {
        movements: 0,
        containers: new Set<string>(),
        drivers: new Set<string>(),
      };
      trailer.movements += 1;
      trailer.containers.add(row.jobItemId);
      if (row.driverUserId) trailer.drivers.add(row.driverUserId);
      trailerMap.set(row.trailerNo, trailer);
    }
    const trailers: StatisticsTrailerRowDto[] = Array.from(trailerMap, ([trailerNo, row]) => ({
      trailerNo,
      movements: row.movements,
      uniqueContainers: row.containers.size,
      drivers:
        uniqueSorted(
          Array.from(row.drivers).map((id) => names.get(id) ?? "Unnamed driver"),
        ).join(", ") || "—",
    })).sort((left, right) => right.movements - left.movements || compareText(left.trailerNo, right.trailerNo));

    return { vehicles, trailers };
  }

  private toCompact(row: MovementRecord): CompactMovement | null {
    const trip = row.trip;
    if (!trip?.job || !trip.closedAt || !trip.jobId) return null;
    if (trip.status === TripStatus.CANCELLED) return null;
    if (!COMPLETED_TRIP_STATUSES.includes(trip.status as (typeof COMPLETED_TRIP_STATUSES)[number])) {
      return null;
    }
    const duration = resolveTripDuration({
      startedAt: trip.startedAt,
      closedAt: trip.closedAt,
    });
    const vehicleKey = trip.fleetVehicleId ?? trip.vehicleId ?? `plate:${trip.acceptedVehicleNo ?? "unassigned"}`;
    return {
      movementId: row.id,
      jobItemId: row.jobItemId,
      containerNo: displayContainerNo(row.jobItem.itemCode, row.containerNumberSnapshot),
      containerSize: inferContainerSizeLabel(row.jobItem.description),
      jobId: trip.job.id,
      jobNo: displayJobNo(trip.job.internalRef),
      jobType: trip.job.jobType,
      customerId: trip.job.customerCompanyId,
      customerName: trip.job.customerCompany.name,
      tripId: trip.id,
      jobSequence: trip.jobSequence,
      tripSequence: trip.tripSequence,
      originLabel: trip.originLabel,
      destinationLabel: trip.destinationLabel,
      driverUserId: trip.assignedDriverUserId,
      vehicleKey,
      vehiclePlate: displayVehiclePlate(
        trip.fleetVehicle?.plateNo,
        trip.vehicles?.plateNo,
        trip.acceptedVehicleNo,
      ),
      vehicleType: trip.fleetVehicle?.type ?? trip.vehicles?.type ?? null,
      trailerNo: displayTrailerNo(trip.trailerNumber, trip.acceptedTrailerNo),
      tripStatus: trip.status,
      startedAt: trip.startedAt,
      closedAt: trip.closedAt,
      durationMs: duration.valid ? duration.durationMs : null,
    };
  }

  private toMovementRow(
    row: CompactMovement,
    names: Map<string, string>,
    documentation: Map<string, string>,
  ): StatisticsContainerMovementRowDto {
    return {
      movementId: row.movementId,
      movementDate: row.closedAt,
      containerNo: row.containerNo,
      containerSize: row.containerSize,
      jobNo: row.jobNo,
      jobType: displayJobType(row.jobType),
      customerName: row.customerName,
      tripRef: displayTripReference({
        jobNo: row.jobNo,
        jobSequence: row.jobSequence,
        tripSequence: row.tripSequence,
      }),
      origin: displayLaneEndpoint(row.originLabel, "origin"),
      destination: displayLaneEndpoint(row.destinationLabel, "destination"),
      driverName: row.driverUserId
        ? names.get(row.driverUserId) ?? "Unnamed driver"
        : null,
      vehiclePlate: row.vehiclePlate,
      trailerNo: row.trailerNo,
      tripStatus: displayTripStatus(row.tripStatus),
      startedAt: row.startedAt,
      completedAt: row.closedAt,
      durationMs: row.durationMs,
      documentationStatus: documentation.get(row.tripId) ?? "Not evaluated",
      jobHref: `/jobs/${row.jobId}`,
      tripHref: `/jobs/${row.jobId}/workspace?tripId=${row.tripId}`,
    };
  }

  private async documentationByTrip(
    tenantId: string,
    tripIds: string[],
    records: MovementRecord[],
  ): Promise<Map<string, string>> {
    const uniqueTripIds = Array.from(new Set(tripIds));
    const result = new Map<string, string>();
    if (uniqueTripIds.length === 0) return result;
    const ruleByTrip = new Map(
      records.map((row) => [row.trip.id, row.trip.completionRuleJson] as const),
    );
    const documents = await this.prisma.tripDocument.findMany({
      where: { tenantId, tripId: { in: uniqueTripIds }, isActive: true },
      select: {
        tripId: true,
        type: true,
        isActive: true,
        generatedBySystem: true,
        isSigned: true,
        signedAt: true,
      },
    });
    const requirementsByTrip = await loadTripDocumentRequirementSnapshotsByTrip(
      this.prisma,
      tenantId,
      uniqueTripIds,
    );
    const docsByTrip = new Map<string, typeof documents>();
    for (const document of documents) {
      const list = docsByTrip.get(document.tripId) ?? [];
      list.push(document);
      docsByTrip.set(document.tripId, list);
    }
    for (const tripId of uniqueTripIds) {
      const rule = ruleByTrip.get(tripId);
      if (!hasResolvableRequiredDocumentRule(rule)) {
        result.set(tripId, "Not required");
        continue;
      }
      const evaluation = evaluateRequiredDocumentCompletion(
        rule,
        docsByTrip.get(tripId) ?? [],
        requirementsByTrip.get(tripId) ?? [],
      );
      result.set(tripId, evaluation.complete ? "Complete" : "Incomplete");
    }
    return result;
  }

  private async driverNames(
    tenantId: string,
    driverUserIds: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const ids = Array.from(
      new Set(
        driverUserIds.filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    if (ids.length === 0) return new Map();
    const profiles = (await this.prisma.drivers.findMany({
      where: { tenantId, userId: { in: ids } },
      select: { userId: true, name: true },
    })) as Array<{ userId: string | null; name: string | null }>;
    const names = new Map<string, string>();
    for (const profile of profiles) {
      if (!profile.userId) continue;
      const name = displayPersonName(profile.name);
      if (name) names.set(profile.userId, name);
    }
    const missing = ids.filter((id) => !names.has(id));
    if (missing.length > 0) {
      const users = (await this.prisma.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, name: true, displayName: true },
      })) as Array<{ id: string; name: string | null; displayName: string | null }>;
      for (const user of users) {
        const name = displayPersonName(user.displayName, user.name);
        if (name) names.set(user.id, name);
      }
    }
    return names;
  }

  private async resolveRange(
    tenantId: string,
    query: { from?: string; to?: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = resolveStatisticsDateRange(
      { from: query.from, to: query.to },
      tenant?.timezone,
    );
    return { range, timeZone: range.timeZone };
  }
}
