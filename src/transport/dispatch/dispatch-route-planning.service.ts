import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  MembershipStatus,
  Role,
  TripStatus,
} from "@prisma/client";
import { AuditService } from "../../shared/audit/audit.service";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { RealtimeEventsService } from "../../shared/realtime/realtime-events.service";
import { getSafeTenantTimezone } from "../../shared/common/tenant-timezone";
import { suggestTripOrderByNearestNeighbour } from "../trips/trip-order-suggest";
import { buildTripDisplayRef } from "../trips/trip-display-ref";
import { TransportJobsService } from "../jobs/transport-jobs.service";
import {
  dateKeyInTenantTimezone,
  tenantOperatingDayBounds,
  todayOperatingDate,
} from "./dispatch-day-bounds";
import {
  assertLockedAbsoluteDispatchPositions,
  compareDispatchSequence,
  DISPATCH_PLAN_CONFLICT_CODE,
  isDispatchSequenceLocked,
  mergeSuggestedWithLockedAbsolutePositions,
  PLANNING_EXCLUDED,
} from "./dispatch-sequence";
import type {
  DispatchPlanPublishDto,
  DispatchPlanSaveDto,
  DispatchPlanSuggestDto,
} from "./dto/dispatch-route-planning.dto";

export { DISPATCH_PLAN_CONFLICT_CODE };

type ResolvedDriverAssignment = {
  driverUserId: string;
  driverRowId: string | null;
  vehicleId: string | null;
  fleetVehicleId: string | null;
};

@Injectable()
export class DispatchRoutePlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transportJobs: TransportJobsService,
    @Optional() private readonly realtime?: RealtimeEventsService,
  ) {}

  private async resolveTenantTimezone(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return getSafeTenantTimezone(tenant?.timezone);
  }

  private conflict(message: string, extra?: Record<string, unknown>): never {
    throw new ConflictException({
      code: DISPATCH_PLAN_CONFLICT_CODE,
      message,
      ...extra,
    });
  }

  /**
   * Canonical driver eligibility for Dispatch assign (tenant-bound).
   * Does not mutate — callers apply inside a transaction.
   */
  private async resolveDriverAssignment(
    tenantId: string,
    driverUserId: string,
  ): Promise<ResolvedDriverAssignment> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: driverUserId,
        role: Role.DRIVER,
        status: MembershipStatus.Active,
      },
      select: { userId: true },
    });
    if (!membership) {
      throw new BadRequestException(
        "Driver must belong to tenant and be active",
      );
    }
    const driverRow = await this.prisma.drivers.findFirst({
      where: { tenantId, userId: driverUserId },
      select: {
        id: true,
        assignedVehicleId: true,
        assignedFleetVehicleId: true,
      },
    });
    const [vehicle, fleetVehicle] = await Promise.all([
      driverRow?.assignedVehicleId
        ? this.prisma.vehicle.findFirst({
            where: { id: driverRow.assignedVehicleId, tenantId },
            select: { id: true },
          })
        : Promise.resolve(null),
      driverRow?.assignedFleetVehicleId
        ? this.prisma.fleetVehicle.findFirst({
            where: { id: driverRow.assignedFleetVehicleId, tenantId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      driverUserId,
      driverRowId: driverRow?.id ?? null,
      vehicleId: vehicle?.id ?? null,
      fleetVehicleId: fleetVehicle?.id ?? null,
    };
  }

  private toPlanningTrip(
    trip: any,
    timezone: string,
    driverNameByUserId: Map<string, string | null>,
  ) {
    const missingOrigin =
      trip.originLat == null ||
      trip.originLng == null ||
      !Number.isFinite(Number(trip.originLat)) ||
      !Number.isFinite(Number(trip.originLng));
    const missingDestination =
      trip.destinationLat == null ||
      trip.destinationLng == null ||
      !Number.isFinite(Number(trip.destinationLat)) ||
      !Number.isFinite(Number(trip.destinationLng));
    const driverUserId = trip.assignedDriverUserId ?? null;
    return {
      id: trip.id,
      jobId: trip.jobId,
      jobInternalRef: trip.job?.internalRef ?? null,
      customerName: trip.job?.customerCompany?.name ?? null,
      // Display refs stay job-local — never use dispatchSequence here.
      tripDisplayRef: buildTripDisplayRef({
        jobInternalRef: trip.job?.internalRef ?? null,
        tripSequence: trip.tripSequence ?? null,
        jobSequence: trip.jobSequence ?? null,
        tripId: trip.id,
      }),
      tripType: trip.tripType ?? null,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt,
      tripSequence: trip.tripSequence,
      jobSequence: trip.jobSequence,
      dispatchSequence: trip.dispatchSequence ?? null,
      dispatchVersion: trip.dispatchVersion ?? 1,
      sequenceLocked: isDispatchSequenceLocked(trip.status),
      canPublish: trip.status === TripStatus.DRAFT,
      assignedDriverUserId: driverUserId,
      assignedDriverName: driverUserId
        ? driverNameByUserId.get(driverUserId) ?? null
        : null,
      vehicleId: trip.vehicleId ?? null,
      fleetVehicleId: trip.fleetVehicleId ?? null,
      vehiclePlate:
        trip.fleetVehicle?.plateNo ?? trip.vehicles?.plateNo ?? null,
      originLabel: trip.originLabel ?? null,
      destinationLabel: trip.destinationLabel ?? null,
      originLat: trip.originLat ?? null,
      originLng: trip.originLng ?? null,
      destinationLat: trip.destinationLat ?? null,
      destinationLng: trip.destinationLng ?? null,
      missingOriginCoordinates: missingOrigin,
      missingDestinationCoordinates: missingDestination,
      missingLocationWarning:
        missingOrigin || missingDestination
          ? "Trip is missing coordinates required for sequence suggestion"
          : null,
      operatingDateKey: dateKeyInTenantTimezone(
        trip.plannedStartAt ?? trip.createdAt,
        timezone,
      ),
    };
  }

  async getBoard(tenantId: string, date?: string) {
    const timezone = await this.resolveTenantTimezone(tenantId);
    const selectedDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : todayOperatingDate(timezone);
    const { dayStart, dayEnd } = tenantOperatingDayBounds(
      selectedDate,
      timezone,
    );

    const [driverMemberships, trips] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where: {
          tenantId,
          role: Role.DRIVER,
          status: MembershipStatus.Active,
        },
        include: {
          user: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.trip.findMany({
        where: {
          tenantId,
          status: { notIn: PLANNING_EXCLUDED },
          OR: [
            { plannedStartAt: { not: null, gte: dayStart, lt: dayEnd } },
            {
              plannedStartAt: null,
              createdAt: { gte: dayStart, lt: dayEnd },
            },
          ],
        },
        include: {
          job: {
            select: {
              id: true,
              internalRef: true,
              customerCompany: { select: { name: true } },
            },
          },
          vehicles: { select: { id: true, plateNo: true } },
          fleetVehicle: { select: { id: true, plateNo: true } },
        },
        orderBy: [{ dispatchSequence: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    const dayTrips = trips.filter(
      (t) =>
        dateKeyInTenantTimezone(t.plannedStartAt ?? t.createdAt, timezone) ===
        selectedDate,
    );

    const driverUsers = driverMemberships
      .map((m) => m.user)
      .filter(Boolean);
    const driverNameByUserId = new Map<string, string | null>(
      driverUsers.map((d) => [d.id, d.name ?? null]),
    );
    const assignedIds: string[] = [];
    for (const t of dayTrips) {
      if (
        t.assignedDriverUserId &&
        !driverNameByUserId.has(t.assignedDriverUserId)
      ) {
        if (!assignedIds.includes(t.assignedDriverUserId)) {
          assignedIds.push(t.assignedDriverUserId);
        }
      }
    }
    if (assignedIds.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: assignedIds } },
        select: { id: true, name: true },
      });
      for (const u of users) driverNameByUserId.set(u.id, u.name ?? null);
    }

    const driverUserIds = driverUsers.map((d) => d.id);
    const profiles = driverUserIds.length
      ? await this.prisma.drivers.findMany({
          where: { tenantId, userId: { in: driverUserIds } },
          select: {
            id: true,
            userId: true,
            assignedVehicle: { select: { plateNo: true } },
            assignedFleetVehicle: { select: { plateNo: true } },
          },
        })
      : [];
    const profileMap = new Map<
      string,
      {
        id: string;
        userId: string | null;
        assignedVehicle: { plateNo: string } | null;
        assignedFleetVehicle: { plateNo: string } | null;
      }
    >(profiles.map((p) => [p.userId ?? "", p]));

    const planningTrips = dayTrips.map((t) =>
      this.toPlanningTrip(t, timezone, driverNameByUserId),
    );

    const lanes = driverUsers.map((driver) => {
      const laneTrips = planningTrips
        .filter((t) => t.assignedDriverUserId === driver.id)
        .sort(compareDispatchSequence);
      const planVersion = laneTrips.reduce(
        (sum, t) => sum + (t.dispatchVersion ?? 1),
        0,
      );
      const profile = profileMap.get(driver.id);
      return {
        driverUserId: driver.id,
        driverName: driver.name ?? null,
        phone: driver.phone ?? null,
        vehiclePlate:
          profile?.assignedVehicle?.plateNo ??
          profile?.assignedFleetVehicle?.plateNo ??
          null,
        planVersion,
        trips: laneTrips,
      };
    });

    const unassignedTrips = planningTrips
      .filter((t) => !t.assignedDriverUserId)
      .sort(compareDispatchSequence);

    return {
      date: selectedDate,
      timezone,
      generatedAt: new Date().toISOString(),
      planVersion: planningTrips.reduce(
        (sum, t) => sum + (t.dispatchVersion ?? 1),
        0,
      ),
      lanes,
      unassignedTrips,
      trips: planningTrips,
    };
  }

  async suggestSequence(tenantId: string, dto: DispatchPlanSuggestDto) {
    const timezone = await this.resolveTenantTimezone(tenantId);
    const day = dto.date.slice(0, 10);
    const { dayStart, dayEnd } = tenantOperatingDayBounds(day, timezone);

    if (!dto.driverUserId) {
      throw new BadRequestException(
        "driverUserId is required for lane suggestion",
      );
    }

    await this.resolveDriverAssignment(tenantId, dto.driverUserId);

    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: dto.driverUserId,
        status: { notIn: PLANNING_EXCLUDED },
        OR: [
          { plannedStartAt: { not: null, gte: dayStart, lt: dayEnd } },
          { plannedStartAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
        ],
      },
      select: {
        id: true,
        status: true,
        plannedStartAt: true,
        createdAt: true,
        originLat: true,
        originLng: true,
        destinationLat: true,
        destinationLng: true,
        dispatchSequence: true,
      },
      orderBy: [{ dispatchSequence: "asc" }, { createdAt: "asc" }],
    });

    const dayTrips = trips
      .filter(
        (t) =>
          dateKeyInTenantTimezone(t.plannedStartAt ?? t.createdAt, timezone) ===
          day,
      )
      .sort(compareDispatchSequence);
    if (!dayTrips.length) {
      throw new NotFoundException(
        "No eligible trips found for this driver/day",
      );
    }

    const lockedIds = new Set<string>(
      dayTrips
        .filter((t) => isDispatchSequenceLocked(t.status))
        .map((t) => t.id),
    );
    const unlocked = dayTrips.filter((t) => !lockedIds.has(t.id));
    const nn = suggestTripOrderByNearestNeighbour({
      trips: unlocked.map((trip) => ({
        id: trip.id,
        originLat: trip.originLat,
        originLng: trip.originLng,
        destinationLat: trip.destinationLat,
        destinationLng: trip.destinationLng,
        locked: false,
        status: trip.status,
      })),
      startLocation: dto.startLocation
        ? { lat: dto.startLocation.lat, lng: dto.startLocation.lng }
        : null,
    });

    const suggestedTripIdsInOrder = mergeSuggestedWithLockedAbsolutePositions({
      currentOrderedIds: dayTrips.map((t) => t.id),
      suggestedUnlockedIds: nn.suggestedTripIdsInOrder,
      lockedIds,
    });

    return {
      date: day,
      driverUserId: dto.driverUserId,
      algorithm: nn.algorithm,
      label: nn.label,
      suggestedTripIdsInOrder,
      includedTripIds: suggestedTripIdsInOrder,
      excluded: nn.excluded,
      warnings: nn.warnings,
      approximatePlanarDistance: nn.approximatePlanarDistance,
      reason:
        "Deterministic nearest-neighbour ordering using available origin/destination coordinates. Not traffic-aware. Locked ONGOING positions are absolute.",
      persisted: false,
    };
  }

  async savePlan(tenantId: string, dto: DispatchPlanSaveDto, user: any) {
    const timezone = await this.resolveTenantTimezone(tenantId);
    const day = dto.date.slice(0, 10);
    const { dayStart, dayEnd } = tenantOperatingDayBounds(day, timezone);
    const actorUserId: string | null = user?.userId ?? null;

    if (!dto.driverUserId) {
      throw new BadRequestException("driverUserId is required");
    }
    if (!Array.isArray(dto.tripIdsInOrder) || dto.tripIdsInOrder.length === 0) {
      throw new BadRequestException("tripIdsInOrder is required");
    }

    const targetDriver = await this.resolveDriverAssignment(
      tenantId,
      dto.driverUserId,
    );

    // ---- 1) Load + tenant-validate all affected trips/drivers (read-only) ----
    const assignmentRows = Array.isArray(dto.assignments) ? dto.assignments : [];
    const assignmentTargetByTrip = new Map<string, string>();
    for (const row of assignmentRows) {
      if (!row.tripId || !row.driverUserId) {
        throw new BadRequestException("assignments require tripId and driverUserId");
      }
      // Save is lane-scoped: assignments may only target the lane being saved.
      if (row.driverUserId !== dto.driverUserId) {
        throw new BadRequestException(
          "assignments.driverUserId must match the lane driverUserId",
        );
      }
      assignmentTargetByTrip.set(row.tripId, row.driverUserId);
    }

    const assignmentTripIds = [...assignmentTargetByTrip.keys()];
    const assignmentTrips =
      assignmentTripIds.length > 0
        ? await this.prisma.trip.findMany({
            where: { tenantId, id: { in: assignmentTripIds } },
            select: {
              id: true,
              jobId: true,
              status: true,
              assignedDriverUserId: true,
              dispatchVersion: true,
              dispatchSequence: true,
              tripSequence: true,
              jobSequence: true,
              plannedStartAt: true,
              createdAt: true,
            },
          })
        : [];
    if (assignmentTrips.length !== assignmentTripIds.length) {
      throw new BadRequestException(
        "One or more assignment trips were not found in tenant",
      );
    }
    for (const trip of assignmentTrips) {
      if (PLANNING_EXCLUDED.includes(trip.status)) {
        throw new BadRequestException(
          `Trip ${trip.id} cannot be reassigned in its current status`,
        );
      }
      if (!trip.jobId) {
        throw new BadRequestException(`Trip ${trip.id} has no parent job`);
      }
      if (isDispatchSequenceLocked(trip.status)) {
        throw new BadRequestException(
          `Locked trip ${trip.id} cannot be reassigned`,
        );
      }
    }

    // Current lane trips for this operating day (before mutation).
    const openTrips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        status: { notIn: PLANNING_EXCLUDED },
        OR: [
          { plannedStartAt: { not: null, gte: dayStart, lt: dayEnd } },
          { plannedStartAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
        ],
      },
      select: {
        id: true,
        status: true,
        dispatchVersion: true,
        dispatchSequence: true,
        tripSequence: true,
        jobSequence: true,
        plannedStartAt: true,
        createdAt: true,
        jobId: true,
        assignedDriverUserId: true,
      },
    });

    const dayTrips = openTrips.filter(
      (t) =>
        dateKeyInTenantTimezone(t.plannedStartAt ?? t.createdAt, timezone) ===
        day,
    );

    // Simulate post-assignment lane membership for validation.
    const simulatedDriverByTrip = new Map<string, string | null>();
    for (const t of dayTrips) {
      simulatedDriverByTrip.set(t.id, t.assignedDriverUserId ?? null);
    }
    for (const [tripId, driverUserId] of assignmentTargetByTrip) {
      // Assignment trips may be from another day? require operating day membership.
      const trip =
        dayTrips.find((t) => t.id === tripId) ??
        assignmentTrips.find((t) => t.id === tripId);
      if (!trip) {
        throw new BadRequestException(
          `Assignment trip ${tripId} is not eligible for this operating date`,
        );
      }
      const tripDay = dateKeyInTenantTimezone(
        (trip as any).plannedStartAt ?? (trip as any).createdAt,
        timezone,
      );
      if (tripDay !== day) {
        throw new BadRequestException(
          `Assignment trip ${tripId} is not on operating date ${day}`,
        );
      }
      simulatedDriverByTrip.set(tripId, driverUserId);
      if (!dayTrips.some((t) => t.id === tripId)) {
        dayTrips.push(trip as (typeof dayTrips)[number]);
      }
    }

    const laneAfterAssign = dayTrips.filter(
      (t) => simulatedDriverByTrip.get(t.id) === dto.driverUserId,
    );
    const laneBeforeAssign = dayTrips
      .filter((t) => t.assignedDriverUserId === dto.driverUserId)
      .sort(compareDispatchSequence);

    const requested = dto.tripIdsInOrder;
    const existingIds = new Set(laneAfterAssign.map((t) => t.id));
    if (
      requested.some((id) => !existingIds.has(id)) ||
      requested.length !== existingIds.size
    ) {
      throw new BadRequestException(
        "tripIdsInOrder must include exactly all eligible open trip ids for this driver/day after assignments",
      );
    }

    // ---- 2/3) Locked absolute positions + dispatchVersion expectations ----
    const currentOrderedIds = laneBeforeAssign.map((t) => t.id);
    // For locked checks: locked trips already on this lane must keep absolute index
    // relative to the CURRENT saved lane order. Newly assigned trips cannot be locked.
    const lockedOnLane = new Set<string>(
      laneBeforeAssign
        .filter((t) => isDispatchSequenceLocked(t.status))
        .map((t) => t.id),
    );
    // Build requested positions only among trips that were on the lane before assign
    // plus new ones — absolute index is against full requested list which becomes the
    // new lane. Locked trips that were on the lane must appear at the same index in
    // the final requested list as in the current lane order.
    const lockedCheck = assertLockedAbsoluteDispatchPositions({
      currentOrderedIds,
      // Pad/align: locked absolute positions are indexes into the current lane order.
      // After assignments, newly inserted trips shift indexes — product rule: ONGOING
      // saved position must remain fixed in the final order, meaning requested[i] ===
      // currentOrderedIds[i] for each locked i. New assignments must not push locked
      // trips to a different index.
      requestedIds: requested,
      lockedIds: lockedOnLane,
    });
    if (lockedCheck.ok === false) {
      throw new BadRequestException(lockedCheck.message);
    }

    const versionById = new Map<string, number>(
      laneAfterAssign.map((t) => [t.id, Number(t.dispatchVersion ?? 1)]),
    );
    // Prefer per-trip expected versions; fall back to plan sum.
    if (
      Array.isArray(dto.expectedTripVersions) &&
      dto.expectedTripVersions.length > 0
    ) {
      for (const row of dto.expectedTripVersions) {
        const current = versionById.get(row.tripId);
        if (current == null || current !== row.dispatchVersion) {
          this.conflict(
            "Dispatch plan was changed by another user. Reload and try again.",
            { tripId: row.tripId },
          );
        }
      }
    }
    const currentPlanVersion = laneAfterAssign.reduce(
      (sum, t) => sum + (t.dispatchVersion ?? 1),
      0,
    );
    if (
      dto.expectedPlanVersion != null &&
      dto.expectedPlanVersion !== currentPlanVersion
    ) {
      this.conflict(
        "Dispatch plan was changed by another user. Reload and try again.",
        {
          expectedPlanVersion: dto.expectedPlanVersion,
          currentPlanVersion,
        },
      );
    }

    // Snapshot job-local fields for regression assertions / audit.
    const jobLocalBefore = new Map<
      string,
      { tripSequence: number | null; jobSequence: number | null }
    >(
      laneAfterAssign.map((t) => [
        t.id,
        {
          tripSequence: t.tripSequence ?? null,
          jobSequence: t.jobSequence ?? null,
        },
      ]),
    );

    const assignmentAudits: Array<{
      tripId: string;
      jobId: string;
      oldDriverUserId: string | null;
      newDriverUserId: string;
    }> = [];
    for (const trip of assignmentTrips) {
      const newDriverUserId = assignmentTargetByTrip.get(trip.id)!;
      if (trip.assignedDriverUserId !== newDriverUserId) {
        assignmentAudits.push({
          tripId: trip.id,
          jobId: trip.jobId!,
          oldDriverUserId: trip.assignedDriverUserId ?? null,
          newDriverUserId,
        });
      }
    }

    const sequenceChanged =
      laneBeforeAssign.map((t) => t.id).join("|") !== requested.join("|") ||
      assignmentAudits.length > 0;

    // ---- 4/5/6) Atomic assign + CAS dispatch ordering (single update per trip) ----
    try {
      await this.prisma.$transaction(async (tx) => {
        for (let index = 0; index < requested.length; index += 1) {
          const tripId = requested[index]!;
          const expectedVersion = versionById.get(tripId);
          if (expectedVersion == null) {
            throw new BadRequestException(`Missing version for trip ${tripId}`);
          }

          const needsAssign = assignmentTargetByTrip.has(tripId);
          const data: Record<string, unknown> = {
            dispatchSequence: index + 1,
            dispatchVersion: { increment: 1 },
            updatedByUserId: actorUserId,
            // Explicitly do NOT touch tripSequence / jobSequence / routeVersion.
          };
          if (needsAssign) {
            data.assignedDriverUserId = targetDriver.driverUserId;
            data.driverId = targetDriver.driverRowId;
            data.vehicleId = targetDriver.vehicleId;
            data.fleetVehicleId = targetDriver.fleetVehicleId;
            data.assignedAt = new Date();
            data.assignedByUserId = actorUserId;
          }

          const where: Record<string, unknown> = {
            id: tripId,
            tenantId,
            dispatchVersion: expectedVersion,
            status: { notIn: PLANNING_EXCLUDED },
          };
          // Already on-lane trips must stay on this driver; newly assigned may still
          // be elsewhere until this CAS write lands.
          if (!needsAssign) {
            where.assignedDriverUserId = dto.driverUserId;
          }

          const updated = await tx.trip.updateMany({
            where,
            data,
          });
          if (updated.count !== 1) {
            this.conflict(
              "Dispatch plan was changed by another user. Reload and try again.",
              { tripId, phase: needsAssign ? "assignment+sequence" : "sequence" },
            );
          }
          versionById.set(tripId, expectedVersion + 1);
        }

        // Prove job-local sequences unchanged inside the same transaction.
        const after = await tx.trip.findMany({
          where: { tenantId, id: { in: requested } },
          select: {
            id: true,
            tripSequence: true,
            jobSequence: true,
          },
        });
        for (const row of after) {
          const before = jobLocalBefore.get(row.id);
          if (!before) continue;
          if (
            (row.tripSequence ?? null) !== before.tripSequence ||
            (row.jobSequence ?? null) !== before.jobSequence
          ) {
            throw new BadRequestException(
              "Dispatch save must not modify job-local tripSequence/jobSequence",
            );
          }
        }
      });
    } catch (err) {
      if (err instanceof ConflictException || err instanceof BadRequestException) {
        throw err;
      }
      throw err;
    }

    // ---- 8) Audit / realtime only after successful commit ----
    for (const row of assignmentAudits) {
      await this.audit.log(
        tenantId,
        row.oldDriverUserId ? "TRIP_DRIVER_REASSIGNED" : "TRIP_DRIVER_ASSIGNED",
        "TRIP",
        row.tripId,
        {
          jobId: row.jobId,
          oldDriverUserId: row.oldDriverUserId,
          newDriverUserId: row.newDriverUserId,
          source: "DISPATCH_ROUTE_PLANNING",
        },
        actorUserId,
      );
    }
    if (sequenceChanged) {
      await this.audit.log(
        tenantId,
        "DISPATCH_SEQUENCE_CHANGED",
        "DISPATCH_PLAN",
        `${tenantId}:${day}:${dto.driverUserId}`,
        {
          date: day,
          driverUserId: dto.driverUserId,
          tripIdsInOrder: requested,
        },
        actorUserId,
      );
    }
    this.realtime?.publishDispatchAndDashboard(tenantId, {
      driverUserId: dto.driverUserId,
      reason: "dispatch.plan.saved",
    });

    const tripVersions = requested.map((tripId) => ({
      tripId,
      dispatchVersion: versionById.get(tripId) ?? 1,
    }));
    return {
      ok: true,
      date: day,
      driverUserId: dto.driverUserId,
      tripIdsInOrder: requested,
      planVersion: tripVersions.reduce((s, r) => s + r.dispatchVersion, 0),
      tripVersions,
      published: false,
      preservedJobLocalSequences: true,
    };
  }

  async publishPlan(
    tenantId: string,
    dto: DispatchPlanPublishDto,
    user: any,
  ) {
    const actorUserId: string | null = user?.userId ?? null;
    if (!Array.isArray(dto.tripIds) || dto.tripIds.length === 0) {
      throw new BadRequestException("tripIds is required");
    }

    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        id: { in: dto.tripIds },
      },
      select: { id: true, jobId: true, status: true },
    });
    if (trips.length !== dto.tripIds.length) {
      throw new BadRequestException(
        "One or more trips were not found in tenant",
      );
    }

    const published: string[] = [];
    const skipped: Array<{ tripId: string; reason: string }> = [];

    for (const trip of trips) {
      if (!trip.jobId) {
        skipped.push({ tripId: trip.id, reason: "MISSING_JOB" });
        continue;
      }
      if (trip.status !== TripStatus.DRAFT) {
        skipped.push({ tripId: trip.id, reason: `STATUS_${trip.status}` });
        continue;
      }
      await this.transportJobs.publishTrip(
        tenantId,
        trip.jobId,
        trip.id,
        user,
      );
      published.push(trip.id);
    }

    if (published.length > 0) {
      await this.audit.log(
        tenantId,
        "DISPATCH_PLAN_PUBLISHED",
        "DISPATCH_PLAN",
        `${tenantId}:${dto.date ?? "na"}`,
        {
          date: dto.date ?? null,
          publishedTripIds: published,
          skipped,
        },
        actorUserId,
      );
    }

    this.realtime?.publishDispatchAndDashboard(tenantId, {
      reason: "dispatch.plan.published",
    });

    return {
      ok: true,
      publishedTripIds: published,
      skipped,
    };
  }
}
