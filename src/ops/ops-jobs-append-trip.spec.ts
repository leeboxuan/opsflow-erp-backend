import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { JobStatus, JobTripTemplate } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";
import { AppendJobTripDto } from "./dto/job-trip.dto";

describe("AppendJobTripDto validation", () => {
  it("accepts CUSTOM and operational route fields", async () => {
    const dto = plainToInstance(AppendJobTripDto, {
      jobTripTemplate: "CUSTOM",
      plannedStartAt: "2026-05-04T08:00:00.000Z",
      originSummary: "A",
      destinationSummary: "B",
      originLat: 1.3,
      originLng: 103.8,
      destinationLat: 1.2,
      destinationLng: 103.7,
      earningRateMasterId: "rate-1",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects invalid coordinates", async () => {
    const dto = plainToInstance(AppendJobTripDto, {
      jobTripTemplate: "CUSTOM",
      originLat: 91,
      originLng: 181,
      destinationLat: -91,
      destinationLng: -181,
    });
    const errors = await validate(dto);
    const props = errors.map((e) => e.property);
    expect(props).toEqual(
      expect.arrayContaining([
        "originLat",
        "originLng",
        "destinationLat",
        "destinationLng",
      ]),
    );
  });
});

describe("OpsJobsService.appendTrip", () => {
  function makeService(overrides?: Partial<any>) {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: JobStatus.ONGOING,
          trips: [{ jobSequence: 1 }],
        }),
      },
      trip: {
        create: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "rate-1",
          label: "Flat",
          rateCents: 12000,
          requiresManualAmount: false,
        }),
      },
      ...overrides,
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    return { svc, prisma };
  }

  it("accepts manual CUSTOM payload and persists operational route fields", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      {
        jobTripTemplate: JobTripTemplate.CUSTOM,
        plannedStartAt: "2026-05-04T08:00:00.000Z",
        originSummary: "Jelapang Road",
        destinationSummary: "Cogent",
        originPostalCode: null,
        destinationPostalCode: "627545",
        originPlaceId: "origin-place",
        destinationPlaceId: "dest-place",
        originLat: 1.3860517,
        originLng: 103.7672571,
        destinationLat: 1.3122508,
        destinationLng: 103.6971501,
      },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.jobTripTemplate).toBe(JobTripTemplate.CUSTOM);
    expect(data.plannedStartAt).toEqual(new Date("2026-05-04T08:00:00.000Z"));
    expect(data.originLabel).toBe("Jelapang Road");
    expect(data.destinationLabel).toBe("Cogent");
    expect(data.destinationPostalCode).toBe("627545");
    expect(data.originPlaceId).toBe("origin-place");
    expect(data.destinationPlaceId).toBe("dest-place");
    expect(data.originLat).toBeCloseTo(1.3860517, 5);
    expect(data.destinationLng).toBeCloseTo(103.6971501, 5);
  });

  it("treats null/undefined/empty template as CUSTOM", async () => {
    const { svc, prisma } = makeService();

    await svc.appendTrip("t1", "job1", { jobTripTemplate: undefined }, { userId: "u1", role: "OPS" });
    expect(prisma.trip.create.mock.calls[0][0].data.jobTripTemplate).toBe(JobTripTemplate.CUSTOM);

    await svc.appendTrip("t1", "job1", { jobTripTemplate: null as any }, { userId: "u1", role: "OPS" });
    expect(prisma.trip.create.mock.calls[1][0].data.jobTripTemplate).toBe(JobTripTemplate.CUSTOM);

    await svc.appendTrip("t1", "job1", { jobTripTemplate: "" as any }, { userId: "u1", role: "OPS" });
    expect(prisma.trip.create.mock.calls[2][0].data.jobTripTemplate).toBe(JobTripTemplate.CUSTOM);
  });

  it("rejects bad non-null template", async () => {
    const { svc } = makeService();
    await expect(
      svc.appendTrip("t1", "job1", { jobTripTemplate: "BAD" as any }, { userId: "u1", role: "OPS" }),
    ).rejects.toThrow("jobTripTemplate must be one of");
  });

  it("preserves tenant/job ownership checks", async () => {
    const { svc } = makeService({
      job: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      svc.appendTrip("t1", "missing-job", { jobTripTemplate: JobTripTemplate.CUSTOM }, { userId: "u1", role: "OPS" }),
    ).rejects.toThrow("Job not found");
  });

  it("does not break existing template-based trip creation", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      { jobTripTemplate: JobTripTemplate.DELIVERY_TO_PORT },
      { userId: "u1", role: "OPS" },
    );
    expect(prisma.trip.create.mock.calls[0][0].data.jobTripTemplate).toBe(
      JobTripTemplate.DELIVERY_TO_PORT,
    );
  });

  it("validates and saves earningRateMasterId through existing payout lookup", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      { jobTripTemplate: JobTripTemplate.CUSTOM, earningRateMasterId: "rate-1" },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(prisma.driverPayoutItem.findFirst).toHaveBeenCalled();
    expect(data.payoutItemId).toBe("rate-1");
    expect(data.driverEarningCents).toBe(12000);
    expect(data.earningLabelSnapshot).toBe("Flat");
  });

  it("returns clear error when notes is provided but trip notes storage is unavailable", async () => {
    const { svc } = makeService();
    await expect(
      svc.appendTrip(
        "t1",
        "job1",
        { jobTripTemplate: JobTripTemplate.CUSTOM, notes: "do this first" },
        { userId: "u1", role: "OPS" },
      ),
    ).rejects.toThrow("Trip notes are not supported on create yet");
  });
});
