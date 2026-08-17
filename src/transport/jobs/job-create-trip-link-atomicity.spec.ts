/**
 * Job create + trip + TripJobItem atomicity — fail-closed interactive transaction.
 */
import { JobType, Role, TripStatus } from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";
import {
  assertCreateJobInteractiveTxClient,
  assertPrismaInteractiveTransactionAvailable,
  CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
  CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
} from "./create-job-interactive-tx";
import {
  buildInteractiveTxClient,
  withInteractiveTransaction,
} from "../test-utils/prisma-interactive-transaction.mock";

describe("create-job interactive transaction contract", () => {
  it("assertPrismaInteractiveTransactionAvailable rejects missing $transaction", () => {
    expect(() =>
      assertPrismaInteractiveTransactionAvailable({} as any),
    ).toThrow(/\$transaction is unavailable/i);
  });

  it("assertCreateJobInteractiveTxClient rejects incomplete tx before writes", () => {
    expect(() =>
      assertCreateJobInteractiveTxClient({
        job: { create: jest.fn() },
        trip: { createMany: jest.fn() },
      }),
    ).toThrow(/incomplete/i);
  });

  it("create rejects before job.create when $transaction is missing", async () => {
    const jobCreate = jest.fn();
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", name: "C" }),
      },
      job: { create: jobCreate },
      // no $transaction
    };
    const audit = { log: jest.fn() } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "getNextInternalRef").mockResolvedValue("IMP-1");

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.LCL,
          customerCompanyId: "comp1",
          pickupDate: "2026-04-09",
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "R",
          receiverPhone: "1",
          items: [{ itemCode: "BOX", qty: 1 }],
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/\$transaction is unavailable/i);

    expect(jobCreate).not.toHaveBeenCalled();
  });

  it("create rejects incomplete transaction client before any write", async () => {
    const jobCreate = jest.fn();
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", name: "C" }),
      },
      job: { create: jobCreate },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          // incomplete — missing trip/jobItem/tripJobItem
          job: { create: jobCreate },
        }),
      ),
    };
    const audit = { log: jest.fn() } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "getNextInternalRef").mockResolvedValue("IMP-1");

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.LCL,
          customerCompanyId: "comp1",
          pickupDate: "2026-04-09",
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "R",
          receiverPhone: "1",
          items: [{ itemCode: "BOX", qty: 1 }],
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/incomplete/i);

    expect(jobCreate).not.toHaveBeenCalled();
  });

  it("successful creation uses the transaction client for job, trip and TripJobItem writes", async () => {
    const clientsUsed: any[] = [];
    const txJobCreate = jest.fn().mockResolvedValue({
      id: "job1",
      internalRef: "IMP-1",
      externalRef: null,
      jobType: JobType.IMPORT,
      items: [{ id: "it1", itemCode: "CONT1" }],
      customerCompany: { id: "comp1", name: "C" },
      assignedDriver: null,
      createdBy: null,
    });
    const txTripCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txTripFindMany = jest.fn().mockResolvedValue([
      { id: "trip1", status: TripStatus.DRAFT, containerNumber: null },
    ]);
    const txTripUpdate = jest.fn().mockResolvedValue({});
    const txJobItemRow = {
      id: "it1",
      itemCode: "CONT1",
      description: null,
      sealNo: null,
      pickupReference: null,
      qty: null,
    };
    const txJobItemCreate = jest.fn().mockResolvedValue(txJobItemRow);
    const txJobItemFindMany = jest.fn().mockResolvedValue([txJobItemRow]);
    const txTripJobItemFindMany = jest.fn().mockResolvedValue([]);
    const txTripJobItemCreateMany = jest.fn().mockResolvedValue({ count: 1 });

    const tx = buildInteractiveTxClient(
      {},
      {
        job: { create: txJobCreate } as any,
        trip: {
          createMany: txTripCreateMany,
          findMany: txTripFindMany,
          update: txTripUpdate,
        } as any,
        jobItem: { create: txJobItemCreate, findMany: txJobItemFindMany } as any,
        tripJobItem: {
          findMany: txTripJobItemFindMany,
          createMany: txTripJobItemCreateMany,
        } as any,
      },
    );

    const rootJobCreate = jest.fn();
    const prisma: any = withInteractiveTransaction(
      {
        customer_companies: {
          findFirst: jest.fn().mockResolvedValue({ id: "comp1", name: "C" }),
        },
        masterLogisticsLocation: {
          findFirst: jest.fn().mockResolvedValue({
            code: "PSA",
            name: "PSA",
            type: "PORT",
          }),
        },
        job: {
          create: rootJobCreate,
          findFirst: jest.fn().mockResolvedValue({
            id: "job1",
            internalRef: "IMP-1",
            externalRef: null,
            jobType: JobType.IMPORT,
            customerCompany: { id: "comp1", name: "C" },
            assignedDriver: null,
            createdBy: { id: "u1", name: "Ops", email: "o@e.com" },
            items: [{ id: "it1", itemCode: "CONT1" }],
            trips: [],
            charges: [],
            documents: [],
          }),
        },
        trip: {
          createMany: jest.fn(),
          findMany: jest.fn().mockResolvedValue([
            { id: "trip1", status: TripStatus.DRAFT, containerNumber: null },
          ]),
        },
        tripJobItem: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn(),
        },
        jobItem: { findMany: jest.fn().mockResolvedValue([]) },
      },
      tx,
    );
    // Capture which client createJobWithTripsAndLinks receives.
    const originalTx = prisma.$transaction;
    prisma.$transaction = jest.fn(async (fn: any) => {
      return originalTx.mock.calls.length >= 0
        ? fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                clientsUsed.push(target);
                return Reflect.get(target, prop, receiver);
              },
            }),
          )
        : fn(tx);
    });

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "getNextInternalRef").mockResolvedValue("IMP-1");
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest.spyOn(svc as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);

    await svc.create(
      "t1",
      {
        jobType: JobType.IMPORT,
        customerCompanyId: "comp1",
        pickupDate: "2026-04-09",
        pickupAddress1: "A",
        deliveryAddress1: "B",
        receiverName: "R",
        receiverPhone: "1",
        pickupPortCode: "PSA",
        items: [{ itemCode: "CONT1" }],
        importDetails: { returningDepotAddress1: "Tuas Depot" },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(txJobCreate).toHaveBeenCalled();
    expect(txJobItemCreate).toHaveBeenCalled();
    expect(txTripCreateMany).toHaveBeenCalled();
    expect(txTripJobItemCreateMany).toHaveBeenCalled();
    expect(rootJobCreate).not.toHaveBeenCalled();
    expect(clientsUsed.length).toBeGreaterThan(0);
  });

  it("link creation failure rolls back and does not return a created job", async () => {
    const txJobCreate = jest.fn().mockResolvedValue({
      id: "job1",
      internalRef: "IMP-1",
      items: [{ id: "it1", itemCode: "CONT1" }],
      customerCompany: { id: "comp1", name: "C" },
      assignedDriver: null,
    });
    const txJobItemRow = {
      id: "it1",
      itemCode: "CONT1",
      description: null,
      sealNo: null,
      pickupReference: null,
      qty: null,
    };
    const tx = buildInteractiveTxClient(
      {},
      {
        job: { create: txJobCreate } as any,
        trip: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([
            { id: "trip1", status: TripStatus.DRAFT, containerNumber: null },
          ]),
          update: jest.fn().mockResolvedValue({}),
        } as any,
        jobItem: {
          create: jest.fn().mockResolvedValue(txJobItemRow),
          findMany: jest.fn().mockResolvedValue([txJobItemRow]),
        } as any,
        tripJobItem: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockRejectedValue(new Error("link create failed")),
        } as any,
      },
    );

    let committed = false;
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", name: "C" }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockResolvedValue({
          code: "PSA",
          name: "PSA",
          type: "PORT",
        }),
      },
      $transaction: jest.fn(async (fn: any) => {
        try {
          const result = await fn(tx);
          committed = true;
          return result;
        } catch (e) {
          committed = false;
          throw e;
        }
      }),
    };

    const audit = { log: jest.fn() } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "getNextInternalRef").mockResolvedValue("IMP-1");
    const finalize = jest.spyOn(svc, "finalizeCanonicalJobCreate");

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.IMPORT,
          customerCompanyId: "comp1",
          pickupDate: "2026-04-09",
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "R",
          receiverPhone: "1",
          pickupPortCode: "PSA",
          items: [{ itemCode: "CONT1" }],
          importDetails: { returningDepotAddress1: "Tuas Depot" },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/link create failed/);

    expect(committed).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
        timeout: CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
      },
    );
  });

  it("passes explicit maxWait and timeout on the canonical create transaction", async () => {
    const txJobCreate = jest.fn().mockResolvedValue({
      id: "job1",
      internalRef: "EXP-1",
      items: [{ id: "it1", itemCode: "CONT1" }],
      customerCompany: { id: "comp1", name: "C" },
      assignedDriver: null,
    });
    const txJobItemRow = {
      id: "it1",
      itemCode: "CONT1",
      description: null,
      sealNo: null,
      pickupReference: null,
      qty: null,
    };
    const tx = buildInteractiveTxClient(
      {},
      {
        job: { create: txJobCreate } as any,
        trip: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([
            { id: "t1", status: TripStatus.DRAFT, containerNumber: "CONT1", jobTripTemplate: "DELIVERY_TO_PORT" },
          ]),
          update: jest.fn().mockResolvedValue({}),
        } as any,
        jobItem: {
          create: jest.fn().mockResolvedValue(txJobItemRow),
          findMany: jest.fn().mockResolvedValue([txJobItemRow]),
        } as any,
        tripJobItem: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        } as any,
      },
    );

    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", name: "C" }),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          internalRef: "EXP-1",
          jobType: JobType.EXPORT,
          customerCompany: { id: "comp1", name: "C" },
          assignedDriver: null,
          createdBy: { id: "u1", name: "Ops", email: "o@e.com" },
          items: [{ id: "it1", itemCode: "CONT1" }],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new TransportJobsService(prisma, audit, { getClient: jest.fn() } as any);
    jest.spyOn(svc as any, "getNextInternalRef").mockResolvedValue("EXP-1");
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest.spyOn(svc as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "Depot",
        deliveryAddress1: "Stuffing",
        exportDetails: { exportPortAddress1: "Port" },
        items: [{ itemCode: "CONT1" }],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
        timeout: CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
      },
    );
  });
});
