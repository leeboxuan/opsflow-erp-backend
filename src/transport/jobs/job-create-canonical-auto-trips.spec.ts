/**
 * Canonical auto-trip templates and TripJobItem cargo links on Job create.
 * Manual Create Job and AI import both go through createCanonicalJob.
 */
import { JobTripTemplate, JobType, Role } from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";
import {
  CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
  CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
} from "./create-job-interactive-tx";
import { withInteractiveTransaction } from "../test-utils/prisma-interactive-transaction.mock";
import { CANONICAL_AUTO_TRIP_TEMPLATES } from "../workflows/job-workflow.helpers";

describe("canonical auto-trip creation", () => {
  function makeStatefulPrisma() {
    let seq = 0;
    const jobs: any[] = [];
    const jobItems: any[] = [];
    const trips: any[] = [];
    const tripJobItems: any[] = [];

    const delegates: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      job: {
        create: jest.fn(async ({ data }: any) => {
          const id = `job_${++seq}`;
          const { items: itemsNested, ...jobFields } = data;
          const items = (itemsNested?.create ?? []).map((it: any) => ({
            id: `item_${++seq}`,
            createdAt: new Date(),
            ...it,
            tenantId: data.tenantId,
            jobId: id,
          }));
          const job = {
            id,
            ...jobFields,
            items,
            customerCompany: { id: "comp1", name: "ACME" },
            assignedDriver: null,
          };
          jobs.push(job);
          for (const it of items) jobItems.push(it);
          return job;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const job = jobs.find((j) => j.id === where?.id && j.tenantId === where?.tenantId);
          if (!job) return null;
          return {
            ...job,
            customerCompany: { id: "comp1", name: "ACME" },
            assignedDriver: null,
            createdBy: null,
            items: jobItems.filter((i) => i.jobId === job.id),
            trips: [],
            charges: [],
            documents: [],
            sourceCustomerQuotation: null,
          };
        }),
      },
      trip: {
        createMany: jest.fn(async ({ data }: any) => {
          const rows = Array.isArray(data) ? data : [];
          for (const row of rows) {
            trips.push({
              id: `trip_${++seq}`,
              status: row.status ?? "DRAFT",
              ...row,
            });
          }
          return { count: rows.length };
        }),
        findMany: jest.fn(async ({ where, select }: any = {}) => {
          const matched = trips.filter((t) => {
            if (where?.tenantId && t.tenantId !== where.tenantId) return false;
            if (where?.jobId && t.jobId !== where.jobId) return false;
            return true;
          });
          if (!select) return matched;
          return matched.map((t) => {
            const out: any = {};
            for (const key of Object.keys(select)) {
              if (select[key]) out[key] = t[key];
            }
            return out;
          });
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = trips.find((t) => t.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
      },
      jobItem: {
        findMany: jest.fn(async ({ where }: any = {}) => {
          const ids: string[] | undefined = where?.id?.in;
          return jobItems.filter((i) => {
            if (where?.tenantId && i.tenantId !== where.tenantId) return false;
            if (where?.jobId && i.jobId !== where.jobId) return false;
            if (ids && !ids.includes(i.id)) return false;
            return true;
          });
        }),
      },
      tripJobItem: {
        findMany: jest.fn(async ({ where, include }: any = {}) =>
          tripJobItems
            .filter((l) => {
              if (where?.tenantId && l.tenantId !== where.tenantId) return false;
              if (where?.tripId && l.tripId !== where.tripId) return false;
              return true;
            })
            .map((l) => {
              if (!include?.jobItem) return l;
              const it = jobItems.find((j) => j.id === l.jobItemId);
              return {
                ...l,
                jobItem: it
                  ? {
                      id: it.id,
                      itemCode: it.itemCode,
                      description: it.description ?? null,
                      sealNo: it.sealNo ?? null,
                      pickupReference: it.pickupReference ?? null,
                      qty: it.qty ?? null,
                    }
                  : null,
              };
            }),
        ),
        createMany: jest.fn(async ({ data }: any) => {
          const rows = Array.isArray(data) ? data : [];
          for (const row of rows) {
            tripJobItems.push({ id: `tji_${++seq}`, ...row });
          }
          return { count: rows.length };
        }),
      },
    };

    const prisma = withInteractiveTransaction(delegates);
    prisma._state = { jobs, jobItems, trips, tripJobItems };
    return prisma;
  }

  function makeSvc(prisma: any) {
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);
    return svc;
  }

  function tripTemplates(prisma: any) {
    return [...prisma._state.trips]
      .sort((a: any, b: any) => a.tripSequence - b.tripSequence)
      .map((t: any) => t.jobTripTemplate);
  }

  function linkedItemIdsForTrip(prisma: any, tripId: string) {
    return prisma._state.tripJobItems
      .filter((l: any) => l.tripId === tripId)
      .map((l: any) => l.jobItemId)
      .sort();
  }

  it("EXPORT creates exactly 3 trips and links containers only on Depot→Customer and Customer→Port", async () => {
    const prisma = makeStatefulPrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "7 Gul Circle",
        deliveryAddress1: "20 Gul Way",
        receiverName: "PIC",
        receiverPhone: "91234567",
        exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
        items: [{ containerNumber: "MSCU1234567", sealNo: "SL1" }],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(tripTemplates(prisma)).toEqual(CANONICAL_AUTO_TRIP_TEMPLATES[JobType.EXPORT]);
    expect(prisma._state.trips.map((t: any) => t.tripSequence)).toEqual([1, 2, 3]);
    const itemIds = prisma._state.jobItems.map((i: any) => i.id).sort();
    expect(itemIds).toHaveLength(1);
    const [depotToCustomer, customerToPort, portToDepot] = [...prisma._state.trips].sort(
      (a: any, b: any) => a.tripSequence - b.tripSequence,
    );
    expect(depotToCustomer.originAddressLine1).toBe("7 Gul Circle");
    expect(depotToCustomer.destinationAddressLine1).toBe("20 Gul Way");
    expect(depotToCustomer.jobTripTemplate).toBe(JobTripTemplate.DEPOT_TO_DELIVERY);
    expect(customerToPort.originAddressLine1).toBe("20 Gul Way");
    expect(customerToPort.destinationAddressLine1).toBe("Pasir Panjang Terminal");
    expect(customerToPort.jobTripTemplate).toBe(JobTripTemplate.DELIVERY_TO_PORT);
    expect(portToDepot.originAddressLine1).toBe("Pasir Panjang Terminal");
    expect(portToDepot.destinationAddressLine1).toBe("7 Gul Circle");
    expect(portToDepot.jobTripTemplate).toBe(JobTripTemplate.PORT_TO_DEPOT);
    expect(depotToCustomer.tripPICName).toBe("PIC");
    expect(customerToPort.tripPICName).toBeNull();
    expect(portToDepot.tripPICName).toBeNull();
    expect(linkedItemIdsForTrip(prisma, depotToCustomer.id)).toEqual(itemIds);
    expect(linkedItemIdsForTrip(prisma, customerToPort.id)).toEqual(itemIds);
    expect(linkedItemIdsForTrip(prisma, portToDepot.id)).toEqual([]);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      maxWait: CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
      timeout: CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
    });
  });

  it("does not run post-commit finalization when the interactive transaction throws P2028", async () => {
    const prisma = makeStatefulPrisma();
    prisma.$transaction = jest.fn(async () => {
      const err: any = new Error(
        "Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5170 ms passed. failing query: prisma.tripJobItem.findMany()",
      );
      err.code = "P2028";
      err.name = "PrismaClientKnownRequestError";
      throw err;
    });
    const svc = makeSvc(prisma);
    const finalize = jest.spyOn(svc, "finalizeCanonicalJobCreate");

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "7 Gul Circle",
          deliveryAddress1: "20 Gul Way",
          receiverName: "PIC",
          receiverPhone: "91234567",
          exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
          items: [{ containerNumber: "MSCU1234567" }],
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toMatchObject({ code: "P2028" });

    expect(finalize).not.toHaveBeenCalled();
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      maxWait: CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
      timeout: CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
    });
  });

  it("IMPORT creates exactly 2 trips and links every container JobItem onto both legs", async () => {
    const prisma = makeStatefulPrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.IMPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "Jurong Port",
        deliveryAddress1: "Customer yard",
        receiverName: "PIC",
        receiverPhone: "91234567",
        importDetails: { returningDepotAddress1: "Tuas Depot" },
        items: [
          { containerNumber: "GESU1111111", sealNo: "A" },
          { containerNumber: "GESU2222222", sealNo: "B" },
        ],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(tripTemplates(prisma)).toEqual(CANONICAL_AUTO_TRIP_TEMPLATES[JobType.IMPORT]);
    expect(prisma._state.trips.map((t: any) => t.tripSequence)).toEqual([1, 2]);
    const itemIds = prisma._state.jobItems.map((i: any) => i.id).sort();
    expect(itemIds).toHaveLength(2);
    for (const trip of prisma._state.trips) {
      expect(linkedItemIdsForTrip(prisma, trip.id)).toEqual(itemIds);
    }
    const [portToCustomer, customerToDepot] = [...prisma._state.trips].sort(
      (a: any, b: any) => a.tripSequence - b.tripSequence,
    );
    expect(portToCustomer.originAddressLine1).toBe("Jurong Port");
    expect(portToCustomer.destinationAddressLine1).toBe("Customer yard");
    expect(customerToDepot.originAddressLine1).toBe("Customer yard");
    expect(customerToDepot.destinationAddressLine1).toBe("Tuas Depot");
  });

  it("LCL creates exactly 1 trip and links all JobItems to that trip", async () => {
    const prisma = makeStatefulPrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.LCL,
        customerCompanyId: "comp1",
        pickupAddress1: "Warehouse A",
        deliveryAddress1: "Warehouse B",
        receiverName: "PIC",
        receiverPhone: "91234567",
        items: [
          { itemCode: "BOX-A", qty: 2 },
          { itemCode: "BOX-B", qty: 3 },
        ],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(tripTemplates(prisma)).toEqual(CANONICAL_AUTO_TRIP_TEMPLATES[JobType.LCL]);
    expect(prisma._state.trips).toHaveLength(1);
    expect(prisma._state.trips[0].tripSequence).toBe(1);
    expect(prisma._state.trips[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
    const itemIds = prisma._state.jobItems.map((i: any) => i.id).sort();
    expect(itemIds).toHaveLength(2);
    expect(linkedItemIdsForTrip(prisma, prisma._state.trips[0].id)).toEqual(itemIds);
  });

  it("COLLECTION creates exactly 1 Pickup → Delivery trip", async () => {
    const prisma = makeStatefulPrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.COLLECTION,
        collectionType: "EMPTY",
        customerCompanyId: "comp1",
        pickupAddress1: "Yard A",
        deliveryAddress1: "Yard B",
        items: [{ containerNumber: "TEMU9999999" }],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(tripTemplates(prisma)).toEqual(CANONICAL_AUTO_TRIP_TEMPLATES[JobType.COLLECTION]);
    expect(prisma._state.trips).toHaveLength(1);
    expect(prisma._state.trips[0].originAddressLine1).toBe("Yard A");
    expect(prisma._state.trips[0].destinationAddressLine1).toBe("Yard B");
  });

  it("EXPORT create fails with an operational message when export port is missing", async () => {
    const prisma = makeStatefulPrisma();
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "7 Gul Circle",
          deliveryAddress1: "20 Gul Way",
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/Export port \/ terminal is required/i);
  });
});
