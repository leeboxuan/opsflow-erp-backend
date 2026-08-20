import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { JobStatus, JobTripTemplate } from "@prisma/client";
import { TransportJobsService } from "../jobs/transport-jobs.service";
import { AppendJobTripDto } from "./dto/job-trip.dto";
import { GUL_CIRCLE_ROUTE_DEFAULTS } from "../workflows/job-workflow.helpers";

describe("AppendJobTripDto validation", () => {
  it("accepts CUSTOM and operational route fields", async () => {
    const dto = plainToInstance(AppendJobTripDto, {
      tripType: "LCL",
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

  it("accepts CUSTOMER_TO_GUL and GUL_TO_CUSTOMER templates", async () => {
    for (const jobTripTemplate of ["CUSTOMER_TO_GUL", "GUL_TO_CUSTOMER"]) {
      const dto = plainToInstance(AppendJobTripDto, {
      tripType: "LCL",
      jobTripTemplate,
        plannedStartAt: "2026-05-25T08:00:00.000Z",
        originSummary: "8 Gul Cir, 8 Gul Circle",
        destinationSummary: "7 Gul Circle",
        originPostalCode: "629564",
        destinationPostalCode: "629563",
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it("accepts text-only Gul Circle route without lat/lng", async () => {
    const dto = plainToInstance(AppendJobTripDto, {
      tripType: "LCL",
      jobTripTemplate: "CUSTOMER_TO_GUL",
      plannedStartAt: "2026-05-25T08:00:00.000Z",
      originSummary: "8 Gul Cir, 8 Gul Circle",
      destinationSummary: "7 Gul Circle",
      originPostalCode: "629564",
      destinationPostalCode: "629563",
      destinationLat: null,
      destinationLng: null,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts structured address fields, unit numbers, and trip notes", async () => {
    const dto = plainToInstance(AppendJobTripDto, {
      tripType: "LCL",
      jobTripTemplate: "CUSTOM",
      plannedStartAt: "2026-06-10T08:30:00.000Z",
      originAddress1: "8 Gul Cir, 8 Gul Circle",
      originAddress2: "#12-34",
      destinationAddress1: "7 Gul Circle",
      destinationAddress2: "Unit 5",
      originPostalCode: "629564",
      destinationPostalCode: "629563",
      originPlaceId: "place-origin",
      destinationPlaceId: "place-dest",
      originLat: 1.31,
      originLng: 103.7,
      destinationLat: 1.32,
      destinationLng: 103.71,
      notes: "Use side gate",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects invalid coordinates", async () => {
    const dto = plainToInstance(AppendJobTripDto, {
      tripType: "LCL",
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

describe("TransportJobsService.appendTrip", () => {
  function makeService(overrides?: Partial<any>) {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          jobType: "LCL",
          status: JobStatus.ONGOING,
          invoiceReadyAt: null,
          trips: [{ jobSequence: 1 }],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      jobTypeAssignment: {
        findMany: jest.fn().mockResolvedValue([{ jobType: "LCL" }]),
      },
      trip: {
        create: jest.fn().mockResolvedValue({ id: "trip1" }),
        delete: jest.fn().mockResolvedValue({ id: "trip1" }),
        findMany: jest.fn().mockResolvedValue([
          { status: "DRAFT" },
        ]),
      },
      jobItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    const svc = new TransportJobsService(
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
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM,
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

    await svc.appendTrip("t1", "job1", { tripType: "LCL" as any, jobTripTemplate: undefined }, { userId: "u1", role: "OPS" });
    expect(prisma.trip.create.mock.calls[0][0].data.jobTripTemplate).toBe(JobTripTemplate.CUSTOM);

    await svc.appendTrip("t1", "job1", { tripType: "LCL" as any, jobTripTemplate: null as any }, { userId: "u1", role: "OPS" });
    expect(prisma.trip.create.mock.calls[1][0].data.jobTripTemplate).toBe(JobTripTemplate.CUSTOM);

    await svc.appendTrip("t1", "job1", { tripType: "LCL" as any, jobTripTemplate: "" as any }, { userId: "u1", role: "OPS" });
    expect(prisma.trip.create.mock.calls[2][0].data.jobTripTemplate).toBe(JobTripTemplate.CUSTOM);
  });

  it("rejects bad non-null template", async () => {
    const { svc } = makeService();
    await expect(
      svc.appendTrip("t1", "job1", { tripType: "LCL" as any, jobTripTemplate: "BAD" as any }, { userId: "u1", role: "OPS" }),
    ).rejects.toThrow("jobTripTemplate must be one of");
  });

  it("preserves tenant/job ownership checks", async () => {
    const { svc } = makeService({
      job: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      svc.appendTrip("t1", "missing-job", { tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM }, { userId: "u1", role: "OPS" }),
    ).rejects.toThrow("Job not found");
  });

  it("does not break existing template-based trip creation", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      { tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.DELIVERY_TO_PORT },
      { userId: "u1", role: "OPS" },
    );
    expect(prisma.trip.create.mock.calls[0][0].data.jobTripTemplate).toBe(
      JobTripTemplate.DELIVERY_TO_PORT,
    );
  });

  it("accepts CUSTOMER_TO_GUL with FE-provided route fields", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      {
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOMER_TO_GUL,
        plannedStartAt: "2026-05-25T08:00:00.000Z",
        originSummary: "8 Gul Cir, 8 Gul Circle",
        destinationSummary: "7 Gul Circle",
        originPostalCode: "629564",
        destinationPostalCode: "629563",
        originPlaceId: "ChIJb88ZJpoF2jERlWtJ-VhHW2A",
        destinationPlaceId: null,
        originLat: 1.3136718,
        originLng: 103.6730866,
        destinationLat: null,
        destinationLng: null,
      },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.jobTripTemplate).toBe(JobTripTemplate.CUSTOMER_TO_GUL);
    expect(data.displayTitle).toBe("Customer → Gul Circle");
    expect(data.originLabel).toBe("8 Gul Cir, 8 Gul Circle");
    expect(data.destinationLabel).toBe("7 Gul Circle");
    expect(data.destinationPostalCode).toBe("629563");
    expect(data.destinationAddressLine1).toBe("7 Gul Circle");
    expect(data.destinationLat).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lat);
    expect(data.destinationLng).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lng);
  });

  it("defaults Gul Circle destination for CUSTOMER_TO_GUL when omitted", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      {
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOMER_TO_GUL,
        originSummary: "Customer site",
      },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.destinationLabel).toBe("7 Gul Circle");
    expect(data.destinationPostalCode).toBe("629563");
    expect(data.destinationLat).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lat);
    expect(data.destinationLng).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lng);
  });

  it("defaults Gul Circle origin for GUL_TO_CUSTOMER when omitted", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      {
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.GUL_TO_CUSTOMER,
        destinationSummary: "Customer site",
      },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.originLabel).toBe("7 Gul Circle");
    expect(data.originPostalCode).toBe("629563");
    expect(data.originLat).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lat);
    expect(data.originLng).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lng);
  });

  it("validates and saves earningRateMasterId through existing payout lookup", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      { tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM, earningRateMasterId: "rate-1" },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(prisma.driverPayoutItem.findFirst).toHaveBeenCalled();
    expect(data.payoutItemId).toBe("rate-1");
    expect(data.driverEarningCents).toBe(12000);
    expect(data.earningLabelSnapshot).toBe("Flat");
  });

  it("saves trip notes when provided on create", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      { tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM, notes: "do this first" },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.notes).toBe("do this first");
  });

  it("stores null when notes is empty on create", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      { tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM, notes: "   " },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.notes).toBeNull();
  });

  it("add trip with only originSummary/destinationSummary still works", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      {
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM,
        originSummary: "Legacy origin",
        destinationSummary: "Legacy destination",
      },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.originAddressLine1).toBe("Legacy origin");
    expect(data.destinationAddressLine1).toBe("Legacy destination");
    expect(data.originAddressLine2).toBeNull();
    expect(data.destinationAddressLine2).toBeNull();
  });

  it("saves originAddress2 and destinationAddress2 on create", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      {
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM,
        originAddress1: "8 Gul Cir, 8 Gul Circle",
        originAddress2: "#12-34",
        destinationAddress1: "7 Gul Circle",
        destinationAddress2: "Unit 5",
        originPostalCode: "629564",
        destinationPostalCode: "629563",
        originPlaceId: "place-origin",
        destinationPlaceId: "place-dest",
        originLat: 1.31,
        originLng: 103.7,
        destinationLat: 1.32,
        destinationLng: 103.71,
      },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.originAddressLine1).toBe("8 Gul Cir, 8 Gul Circle");
    expect(data.originAddressLine2).toBe("#12-34");
    expect(data.destinationAddressLine1).toBe("7 Gul Circle");
    expect(data.destinationAddressLine2).toBe("Unit 5");
    expect(data.originPostalCode).toBe("629564");
    expect(data.destinationPostalCode).toBe("629563");
    expect(data.originPlaceId).toBe("place-origin");
    expect(data.destinationPlaceId).toBe("place-dest");
  });

  it("create trip without notes still works", async () => {
    const { svc, prisma } = makeService();
    await svc.appendTrip(
      "t1",
      "job1",
      { tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM },
      { userId: "u1", role: "OPS" },
    );
    const data = prisma.trip.create.mock.calls[0][0].data;
    expect(data.notes).toBeNull();
  });

  it("create trip with multiple payout lines delegates to existing payout draft logic", async () => {
    const { svc } = makeService();
    const payoutSpy = jest
      .spyOn(svc, "saveTripPayoutDraft")
      .mockResolvedValue({ id: "job1" } as any);
    await svc.appendTrip(
      "t1",
      "job1",
      {
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM,
        earningRateMasterId: "rate-1",
        payoutLines: [
          {
            label: "Line A",
            sourceRateMasterItemId: "rate-1",
            quantity: 1,
            amountCents: 12000,
          },
          {
            label: "Line B",
            isManual: true,
            quantity: 1,
            amountCents: 2000,
          },
        ],
      },
      { userId: "u1", role: "OPS" },
    );
    expect(payoutSpy).toHaveBeenCalledWith(
      "t1",
      "job1",
      "trip1",
      expect.objectContaining({
        earningRateMasterId: "rate-1",
        payoutLines: expect.any(Array),
      }),
      expect.any(Object),
    );
  });

  it("create trip with manual payout line delegates to payout draft logic", async () => {
    const { svc } = makeService();
    const payoutSpy = jest
      .spyOn(svc, "saveTripPayoutDraft")
      .mockResolvedValue({ id: "job1" } as any);
    await svc.appendTrip(
      "t1",
      "job1",
      {
        tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM,
        payoutLines: [
          {
            label: "Manual handling",
            isManual: true,
            requiresManualAmount: true,
            quantity: 1,
            amountCents: 5000,
          },
        ],
      },
      { userId: "u1", role: "OPS" },
    );
    expect(payoutSpy).toHaveBeenCalled();
  });

  it("rejects manual-required source item without amount from delegated payout logic", async () => {
    const { svc, prisma } = makeService();
    jest
      .spyOn(svc, "saveTripPayoutDraft")
      .mockRejectedValueOnce(
        new Error('Selected payout item "Manual" requires manual amount before assignment'),
      );
    await expect(
      svc.appendTrip(
        "t1",
        "job1",
        {
          tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM,
          payoutLines: [
            {
              label: "Manual",
              sourceRateMasterItemId: "rate-manual",
              quantity: 1,
            },
          ],
        },
        { userId: "u1", role: "OPS" },
      ),
    ).rejects.toThrow("requires manual amount");
    expect(prisma.trip.delete).toHaveBeenCalledWith({ where: { id: "trip1" } });
  });

  it("rejects invalid payout item from delegated payout logic", async () => {
    const { svc, prisma } = makeService();
    jest
      .spyOn(svc, "saveTripPayoutDraft")
      .mockRejectedValueOnce(new Error("Invalid source payout item"));
    await expect(
      svc.appendTrip(
        "t1",
        "job1",
        {
          tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM,
          payoutLines: [
            {
              label: "Bad line",
              sourceRateMasterItemId: "does-not-exist",
              quantity: 1,
              amountCents: 1000,
            },
          ],
        },
        { userId: "u1", role: "OPS" },
      ),
    ).rejects.toThrow("Invalid source payout item");
    expect(prisma.trip.delete).toHaveBeenCalledWith({ where: { id: "trip1" } });
  });

  it("appendTrip demotes READY_FOR_INVOICE jobs when new non-cancelled draft trip is added", async () => {
    const { svc, prisma } = makeService({
      job: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "job1",
            status: JobStatus.READY_FOR_INVOICE,
            invoiceReadyAt: new Date("2026-05-01T00:00:00.000Z"),
            trips: [{ jobSequence: 1 }],
          })
          .mockResolvedValueOnce({
            id: "job1",
            status: JobStatus.READY_FOR_INVOICE,
            invoiceReadyAt: new Date("2026-05-01T00:00:00.000Z"),
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      trip: {
        create: jest.fn().mockResolvedValue({ id: "trip1" }),
        delete: jest.fn().mockResolvedValue({ id: "trip1" }),
        findMany: jest.fn().mockResolvedValue([
          { status: "DONE" },
          { status: "DRAFT" },
        ]),
      },
    });

    await svc.appendTrip(
      "t1",
      "job1",
      { tripType: "LCL" as any, jobTripTemplate: JobTripTemplate.CUSTOM },
      { userId: "u1", role: "OPS" },
    );

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: { status: JobStatus.ONGOING, invoiceReadyAt: null },
    });
  });
});
