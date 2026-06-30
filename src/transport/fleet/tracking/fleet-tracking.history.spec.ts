import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ChassisHistoryQueryDto } from "./dto/chassis-history-query.dto";
import {
  computeDistanceKm,
  detectHistoryStops,
  downsampleHistoryPoints,
  haversineKm,
  HISTORY_MAX_DISPLAY_POINTS,
} from "./fleet-tracking.helpers";
import { FleetTrackingService } from "./fleet-tracking.service";

describe("FleetTrackingService chassis history", () => {
  const tenantId = "tenant-1";
  const chassisId = "chassis-1";
  const date = "2026-06-25";

  function makePrisma() {
    const prisma: any = {
      chassis: {
        findFirst: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
      },
      gpsPosition: {
        findMany: jest.fn(),
      },
    };
    return prisma;
  }

  function setupChassis(prisma: any) {
    prisma.chassis.findFirst.mockResolvedValue({
      id: chassisId,
      chassisNo: "TCLU123",
      label: null,
    });
    prisma.tenant.findUnique.mockResolvedValue({ timezone: "Asia/Singapore" });
  }

  function makeGpsRows(
    points: Array<{
      id: string;
      recordedAt: Date;
      lat: number;
      lng: number;
      speedKph?: number | null;
      heading?: number | null;
    }>,
  ) {
    return points.map((point) => ({
      id: point.id,
      recordedAt: point.recordedAt,
      lat: new Prisma.Decimal(point.lat.toFixed(7)),
      lng: new Prisma.Decimal(point.lng.toFixed(7)),
      speedKph: point.speedKph ?? null,
      heading: point.heading ?? null,
    }));
  }

  function makeStagnantRows(
    baseTime: Date,
    count: number,
    intervalMinutes: number,
    lat = 1.3,
    lng = 103.8,
  ) {
    return makeGpsRows(
      Array.from({ length: count }, (_, i) => ({
        id: `stop-point-${i}`,
        recordedAt: new Date(baseTime.getTime() + i * intervalMinutes * 60 * 1000),
        lat,
        lng,
        speedKph: 0,
        heading: 0,
      })),
    );
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("enforces tenant isolation on chassis history lookup", async () => {
    const prisma = makePrisma();
    prisma.chassis.findFirst.mockResolvedValue(null);
    const svc = new FleetTrackingService(prisma);

    await expect(svc.getChassisHistory(tenantId, chassisId, { date })).rejects.toThrow(
      new NotFoundException("Chassis not found"),
    );

    expect(prisma.chassis.findFirst).toHaveBeenCalledWith({
      where: { id: chassisId, tenantId },
      select: { id: true, chassisNo: true, label: true },
    });
    expect(prisma.gpsPosition.findMany).not.toHaveBeenCalled();
  });

  it("rejects invalid date format", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);
    const svc = new FleetTrackingService(prisma);

    await expect(
      svc.getChassisHistory(tenantId, chassisId, { date: "25-06-2026" }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.getChassisHistory(tenantId, chassisId, { date: "2026-13-40" }),
    ).rejects.toThrow(new BadRequestException("date must be YYYY-MM-DD"));
  });

  it("returns empty points and null summary fields when no GPS positions", async () => {
    const prisma = makePrisma();
    prisma.chassis.findFirst.mockResolvedValue({
      id: chassisId,
      chassisNo: "TCLU123",
      label: "Trailer A",
    });
    prisma.tenant.findUnique.mockResolvedValue({ timezone: "Asia/Singapore" });
    prisma.gpsPosition.findMany.mockResolvedValue([]);
    const svc = new FleetTrackingService(prisma);

    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(result).toMatchObject({
      chassisId,
      chassisNo: "TCLU123",
      label: "Trailer A",
      date,
      timezone: "Asia/Singapore",
      points: [],
      stops: [],
      summary: {
        pointCount: 0,
        firstSeenAt: null,
        lastSeenAt: null,
        distanceKm: null,
        maxSpeedKph: null,
        avgSpeedKph: null,
        stopCount: 0,
        stoppedTimeSeconds: 0,
      },
    });
  });

  it("defaults to Asia/Singapore when tenant timezone is missing", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);
    prisma.tenant.findUnique.mockResolvedValue({ timezone: null });
    prisma.gpsPosition.findMany.mockResolvedValue([]);
    const svc = new FleetTrackingService(prisma);

    const result = await svc.getChassisHistory(tenantId, chassisId, { date });
    expect(result.timezone).toBe("Asia/Singapore");
  });

  it("computes distance from consecutive valid points", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const t1 = new Date("2026-06-25T01:00:00.000Z");
    const t2 = new Date("2026-06-25T01:05:00.000Z");
    prisma.gpsPosition.findMany.mockResolvedValue(
      makeGpsRows([
        { id: "p1", recordedAt: t1, lat: 1.3521, lng: 103.8198, speedKph: 10, heading: 90 },
        { id: "p2", recordedAt: t2, lat: 1.3611, lng: 103.8288, speedKph: 20, heading: 180 },
      ]),
    );

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    const expectedKm = computeDistanceKm([
      { id: "p1", recordedAt: t1, lat: 1.3521, lng: 103.8198, speedKph: 10, heading: 90 },
      { id: "p2", recordedAt: t2, lat: 1.3611, lng: 103.8288, speedKph: 20, heading: 180 },
    ]);

    expect(result.summary.pointCount).toBe(2);
    expect(result.summary.distanceKm).toBe(Math.round(expectedKm * 1000) / 1000);
    expect(result.summary.maxSpeedKph).toBe(20);
    expect(result.summary.avgSpeedKph).toBe(15);
    expect(result.summary.firstSeenAt).toBe(t1.toISOString());
    expect(result.summary.lastSeenAt).toBe(t2.toISOString());
    expect(result.stops).toEqual([]);
    expect(result.summary.stopCount).toBe(0);
    expect(result.summary.stoppedTimeSeconds).toBe(0);
  });

  it("converts Decimal coordinates to numbers and filters invalid coordinates", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const validAt = new Date("2026-06-25T02:00:00.000Z");
    prisma.gpsPosition.findMany.mockResolvedValue([
      {
        id: "valid",
        recordedAt: validAt,
        lat: new Prisma.Decimal("1.3000000"),
        lng: new Prisma.Decimal("103.8000000"),
        speedKph: 5,
        heading: 45,
      },
      {
        id: "invalid-lat",
        recordedAt: new Date("2026-06-25T02:01:00.000Z"),
        lat: new Prisma.Decimal("95.0000000"),
        lng: new Prisma.Decimal("103.8000000"),
        speedKph: 5,
        heading: 45,
      },
      {
        id: "invalid-lng",
        recordedAt: new Date("2026-06-25T02:02:00.000Z"),
        lat: new Prisma.Decimal("1.3000000"),
        lng: new Prisma.Decimal("200.0000000"),
        speedKph: 5,
        heading: 45,
      },
    ]);

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toEqual({
      id: "valid",
      recordedAt: validAt.toISOString(),
      lat: 1.3,
      lng: 103.8,
      speedKph: 5,
      heading: 45,
    });
    expect(result.summary.pointCount).toBe(1);
  });

  it("downsamples display points while preserving first and last and full summary", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const total = HISTORY_MAX_DISPLAY_POINTS + 50;
    const rows = Array.from({ length: total }, (_, i) => ({
      id: `p-${i}`,
      recordedAt: new Date(`2026-06-25T00:${String(i % 60).padStart(2, "0")}:00.000Z`),
      lat: new Prisma.Decimal(String(1.3 + i * 0.0001)),
      lng: new Prisma.Decimal(String(103.8 + i * 0.0001)),
      speedKph: i,
      heading: i % 360,
    }));
    prisma.gpsPosition.findMany.mockResolvedValue(rows);

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(result.points.length).toBe(HISTORY_MAX_DISPLAY_POINTS);
    expect(result.points[0].id).toBe("p-0");
    expect(result.points[result.points.length - 1].id).toBe(`p-${total - 1}`);
    expect(result.summary.pointCount).toBe(total);
  });

  it("queries positions within tenant timezone day window", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);
    prisma.tenant.findUnique.mockResolvedValue({ timezone: "America/New_York" });
    prisma.gpsPosition.findMany.mockResolvedValue([]);
    const svc = new FleetTrackingService(prisma);

    await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(prisma.gpsPosition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          chassisId,
          recordedAt: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
        orderBy: { recordedAt: "asc" },
      }),
    );

    const call = prisma.gpsPosition.findMany.mock.calls[0][0];
    const { gte, lt } = call.where.recordedAt;
    expect(lt.getTime() - gte.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("returns no stops when all points are moving", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const base = new Date("2026-06-25T03:00:00.000Z");
    prisma.gpsPosition.findMany.mockResolvedValue(
      makeGpsRows(
        Array.from({ length: 6 }, (_, i) => ({
          id: `move-${i}`,
          recordedAt: new Date(base.getTime() + i * 5 * 60 * 1000),
          lat: 1.3 + i * 0.05,
          lng: 103.8 + i * 0.05,
          speedKph: 45,
          heading: 90,
        })),
      ),
    );

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(result.stops).toEqual([]);
    expect(result.summary.stopCount).toBe(0);
    expect(result.summary.stoppedTimeSeconds).toBe(0);
  });

  it("detects one stop when points stay within 50m for 10+ minutes", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const base = new Date("2026-06-25T04:00:00.000Z");
    prisma.gpsPosition.findMany.mockResolvedValue(makeStagnantRows(base, 12, 1));

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].durationSeconds).toBeGreaterThanOrEqual(600);
    expect(result.stops[0].pointCount).toBe(12);
    expect(result.stops[0].maxRadiusMeters).toBeLessThanOrEqual(50);
    expect(result.stops[0].lat).toBeCloseTo(1.3, 5);
    expect(result.stops[0].lng).toBeCloseTo(103.8, 5);
    expect(result.summary.stopCount).toBe(1);
    expect(result.summary.stoppedTimeSeconds).toBe(result.stops[0].durationSeconds);
  });

  it("does not emit a stop when stagnant duration is under threshold", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const base = new Date("2026-06-25T05:00:00.000Z");
    prisma.gpsPosition.findMany.mockResolvedValue(makeStagnantRows(base, 9, 1));

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(result.stops).toEqual([]);
    expect(result.summary.stopCount).toBe(0);
    expect(result.summary.stoppedTimeSeconds).toBe(0);
  });

  it("detects separate stops when movement resumes between stagnant clusters", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const base = new Date("2026-06-25T06:00:00.000Z");
    const firstStop = makeStagnantRows(base, 12, 1, 1.3, 103.8);
    const moving = makeGpsRows(
      Array.from({ length: 4 }, (_, i) => ({
        id: `move-${i}`,
        recordedAt: new Date(base.getTime() + (12 + i) * 5 * 60 * 1000),
        lat: 1.3 + (i + 1) * 0.08,
        lng: 103.8 + (i + 1) * 0.08,
        speedKph: 40,
        heading: 90,
      })),
    );
    const secondStopStart = new Date(base.getTime() + (12 + 4) * 5 * 60 * 1000);
    const secondStop = makeStagnantRows(secondStopStart, 12, 1, 1.7, 104.1);

    prisma.gpsPosition.findMany.mockResolvedValue([...firstStop, ...moving, ...secondStop]);

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, { date });

    expect(result.stops).toHaveLength(2);
    expect(result.summary.stopCount).toBe(2);
    expect(result.summary.stoppedTimeSeconds).toBe(
      result.stops[0].durationSeconds + result.stops[1].durationSeconds,
    );
    expect(result.stops[0].lat).toBeCloseTo(1.3, 5);
    expect(result.stops[1].lat).toBeCloseTo(1.7, 5);
  });

  it("uses custom stopMinutes and stopRadiusMeters options", async () => {
    const prisma = makePrisma();
    setupChassis(prisma);

    const base = new Date("2026-06-25T07:00:00.000Z");
    prisma.gpsPosition.findMany.mockResolvedValue(makeStagnantRows(base, 7, 1));

    const svc = new FleetTrackingService(prisma);
    const result = await svc.getChassisHistory(tenantId, chassisId, {
      date,
      stopMinutes: 5,
      stopRadiusMeters: 80,
    });

    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].durationSeconds).toBeGreaterThanOrEqual(300);
  });
});

describe("ChassisHistoryQueryDto validation", () => {
  async function validateDto(input: Record<string, unknown>) {
    const dto = plainToInstance(ChassisHistoryQueryDto, input);
    return validate(dto);
  }

  it("accepts default stop detection bounds", async () => {
    const errors = await validateDto({ date: "2026-06-25" });
    expect(errors).toHaveLength(0);
  });

  it("rejects stopMinutes outside 5-60", async () => {
    expect((await validateDto({ date: "2026-06-25", stopMinutes: 4 })).length).toBeGreaterThan(0);
    expect((await validateDto({ date: "2026-06-25", stopMinutes: 61 })).length).toBeGreaterThan(0);
  });

  it("rejects stopRadiusMeters outside 20-300", async () => {
    expect((await validateDto({ date: "2026-06-25", stopRadiusMeters: 19 })).length).toBeGreaterThan(
      0,
    );
    expect((await validateDto({ date: "2026-06-25", stopRadiusMeters: 301 })).length).toBeGreaterThan(
      0,
    );
  });
});

describe("fleet-tracking history helpers", () => {
  it("haversineKm matches known short distance", () => {
    const km = haversineKm(1.3521, 103.8198, 1.3611, 103.8288);
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(2);
  });

  it("downsampleHistoryPoints keeps first and last", () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({ id: i }));
    const sampled = downsampleHistoryPoints(points, 3000);
    expect(sampled).toHaveLength(3000);
    expect(sampled[0].id).toBe(0);
    expect(sampled[sampled.length - 1].id).toBe(4999);
  });

  it("detectHistoryStops computes centroid and maxRadiusMeters", () => {
    const base = new Date("2026-06-25T08:00:00.000Z");
    const points = Array.from({ length: 12 }, (_, i) => ({
      id: `p-${i}`,
      recordedAt: new Date(base.getTime() + i * 60 * 1000),
      lat: 1.3 + (i % 2) * 0.00001,
      lng: 103.8 + (i % 2) * 0.00001,
      speedKph: 0,
      heading: 0,
    }));

    const stops = detectHistoryStops(points);
    expect(stops).toHaveLength(1);
    expect(stops[0].maxRadiusMeters).toBeGreaterThan(0);
    expect(stops[0].maxRadiusMeters).toBeLessThanOrEqual(50);
  });
});
