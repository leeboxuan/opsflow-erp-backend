import { JobTripTemplate, JobStatus, JobType, Role } from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";
import { InvoicesService } from "../finance/invoices.service";
import { withInteractiveTransaction } from "../test-utils/prisma-interactive-transaction.mock";

/** Minimal job row for syncJobInvoiceReadinessForJob after create/publish/unpublish. */
const jobInvoiceSyncRow = {
  id: "job1",
  status: JobStatus.ONGOING,
  invoiceReadyAt: null,
};

/**
 * Ensure create() tests provide a complete interactive `$transaction` client
 * (job + trip + jobItem + tripJobItem). Root mocks remain the write targets.
 */
function withCreateJobTransaction(prisma: any): any {
  const createdItems: any[] = [];
  const enriched = {
    ...prisma,
    trip: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      ...(prisma.trip ?? {}),
    },
    jobItem: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const item = {
          id: `item_${createdItems.length + 1}`,
          itemCode: data.itemCode ?? "BOX",
          description: data.description ?? null,
          sealNo: data.sealNo ?? null,
          pickupReference: data.pickupReference ?? null,
          qty: data.qty ?? 1,
          ...data,
        };
        createdItems.push(item);
        return item;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id) => {
          const found = createdItems.find((item) => item.id === id);
          if (found) return found;
          return {
            id,
            itemCode: "BOX",
            description: null,
            sealNo: null,
            pickupReference: null,
            qty: 1,
          };
        });
      }),
      ...(prisma.jobItem ?? {}),
    },
    tripJobItem: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      ...(prisma.tripJobItem ?? {}),
    },
    jobTypeAssignment: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...(prisma.jobTypeAssignment ?? {}),
    },
  };
  return withInteractiveTransaction(enriched);
}

function withJobInvoiceSyncMocks(prisma: any): any {
  const trip = { ...(prisma.trip ?? {}) };
  return {
    ...prisma,
    job: {
      findFirst: jest.fn().mockResolvedValue(jobInvoiceSyncRow),
      update: jest.fn().mockResolvedValue({}),
      ...(prisma.job ?? {}),
    },
    trip: {
      findMany: jest.fn().mockResolvedValue([]),
      ...trip,
    },
  };
}

describe("job charge workflow hardening", () => {
  it("create job ignores chargeSnapshot-like payload and does not persist charges", async () => {
    const jobChargeDeleteMany = jest.fn().mockResolvedValue({});
    const jobChargeCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = withCreateJobTransaction({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-LCL",
          externalRef: null,
          jobType: JobType.LCL,
          status: "ONGOING",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-09T00:00:00.000Z"),
          pickupAddress1: "Pickup A",
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress1: "Delivery A",
          deliveryAddress2: null,
          deliveryPostal: null,
          receiverName: "Receiver",
          receiverPhone: "123",
          assignedDriverId: null,
          assignedVehicleId: null,
          assignedVehiclePlateNo: null,
          assignedAt: null,
          startedAt: null,
          completedAt: null,
          deliveredAt: null,
          podRecipientName: null,
          cancelledReason: null,
          cancelledAt: null,
          cancelledByUserId: null,
          lastLat: null,
          lastLng: null,
          lastLocationAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
        }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(jobInvoiceSyncRow)
          .mockResolvedValueOnce({
            id: "job1",
            tenantId: "t1",
            customerCompanyId: "comp1",
            internalRef: "WF-2026-04-0001-LCL",
            externalRef: null,
            jobType: JobType.LCL,
            status: "ONGOING",
            notes: null,
            createdByUserId: "u1",
            pickupDate: new Date("2026-04-09T00:00:00.000Z"),
            pickupAddress1: "Pickup A",
            pickupAddress2: null,
            pickupPostal: null,
            pickupContactName: null,
            pickupContactPhone: null,
            deliveryAddress1: "Delivery A",
            deliveryAddress2: null,
            deliveryPostal: null,
            receiverName: "Receiver",
            receiverPhone: "123",
            assignedDriverId: null,
            assignedVehicleId: null,
            assignedVehiclePlateNo: null,
            assignedAt: null,
            startedAt: null,
            completedAt: null,
            deliveredAt: null,
            podRecipientName: null,
            cancelledReason: null,
            cancelledAt: null,
            cancelledByUserId: null,
            lastLat: null,
            lastLng: null,
            lastLocationAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            customerCompany: { id: "comp1", name: "Customer A" },
            assignedDriver: null,
            createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
            items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
            trips: [],
            charges: [],
            documents: [],
          }),
      },
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jobChargeDeleteMany,
        createMany: jobChargeCreateMany,
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;

    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});

    await svc.create(
      "t1",
      {
        jobType: JobType.LCL,
        customerCompanyId: "comp1",
        pickupDate: "2026-04-09",
        pickupAddress1: "Pickup A",
        deliveryAddress1: "Delivery A",
        receiverName: "Receiver",
        receiverPhone: "123",
        items: [{ itemCode: "BOX", qty: 1 }],
        chargeSnapshot: {
          charges: [
            {
              sourceType: "CUSTOMER_QUOTATION",
              sourceRefId: "ql1",
              code: "A1",
              label: "Haulage",
              qty: 1,
              unitPriceCents: 12500,
              currency: "SGD",
              taxable: true,
              taxCode: "SR",
              taxRateBasisPoints: 900,
              sortOrder: 0,
            },
          ],
        },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(jobChargeDeleteMany).not.toHaveBeenCalled();
    expect(jobChargeCreateMany).not.toHaveBeenCalled();
    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ONGOING" }),
      }),
    );
    expect(prisma.trip.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ status: "DRAFT", pendingState: "NONE" }),
        ]),
      }),
    );
  });

  it("create LCL job seeds trip origin from pickupAddress1 and pickupPostal", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const syncJob = {
      id: "job1",
      tenantId: "t1",
      jobType: JobType.LCL,
      pickupAddress1: "7 Gul Cir, 7 Gul Circle",
      pickupAddress2: null,
      pickupPostal: "629563",
      deliveryAddress1: "8 Gul Cir, 8 Gul Circle",
      deliveryAddress2: null,
      deliveryPostal: "629564",
      pickupPortCode: null,
      returningDepotCode: null,
      exportPortCode: null,
      exportOriginDepotCode: null,
      trips: [{ id: "trip1", jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY }],
    };
    const freshJob = {
      ...syncJob,
      customerCompanyId: "comp1",
      internalRef: "WF-2026-05-0001-LCL",
      externalRef: "TEST-REF",
      status: "ONGOING",
      notes: null,
      createdByUserId: "u1",
      pickupDate: new Date("2026-05-21"),
      pickupContactName: null,
      pickupContactPhone: null,
      receiverName: "Derek",
      receiverPhone: "91234565",
      assignedDriverId: null,
      assignedAt: null,
      assignedVehicleId: null,
      assignedFleetVehicleId: null,
      startedAt: null,
      completedAt: null,
      deliveredAt: null,
      invoiceReadyAt: null,
      podRecipientName: null,
      cancelledReason: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      customerCompany: { id: "comp1", name: "Customer A" },
      assignedDriver: null,
      createdBy: null,
      items: [{ id: "i1", itemCode: "01", description: "Metal", qty: 5 }],
      trips: [],
      charges: [],
      documents: [],
    };
    const prisma: any = withCreateJobTransaction({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-05-0001-LCL",
          externalRef: "TEST-REF",
          jobType: JobType.LCL,
          status: "ONGOING",
          vesselName: null,
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          items: [{ id: "i1", itemCode: "01", description: "Metal", qty: 5 }],
        }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(syncJob)
          .mockResolvedValueOnce(jobInvoiceSyncRow)
          .mockResolvedValueOnce(freshJob),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: "trip1" }]),
        update: tripUpdate,
      },
      masterLogisticsLocation: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new TransportJobsService(prisma, audit, {} as any);
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest
      .spyOn(svc as any, "getNextInternalRef")
      .mockResolvedValue("WF-2026-05-0001-LCL");
    jest
      .spyOn(svc as any, "attachTripAssignedDriverNamesForJobs")
      .mockResolvedValue(undefined);

    await svc.create(
      "t1",
      {
        jobType: JobType.LCL,
        customerCompanyId: "comp1",
        externalRef: "TEST-REF",
        pickupDate: "2026-05-21",
        pickupAddress1: "7 Gul Cir, 7 Gul Circle",
        pickupPostal: "629563",
        deliveryAddress1: "8 Gul Cir, 8 Gul Circle",
        deliveryPostal: "629564",
        deliveryPlaceId: "ChIJdest",
        deliveryLat: 1.3136718,
        deliveryLng: 103.6730866,
        receiverName: "Derek",
        receiverPhone: "91234565",
        items: [{ itemCode: "01", description: "Metal", qty: 5 }],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(prisma.trip.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            originLabel: "7 Gul Cir, 7 Gul Circle",
            originAddressLine1: "7 Gul Cir, 7 Gul Circle",
            originPostalCode: "629563",
            originCountry: "SG",
            originLat: null,
            originLng: null,
            originPlaceId: null,
            destinationLabel: "8 Gul Cir, 8 Gul Circle",
            destinationAddressLine1: "8 Gul Cir, 8 Gul Circle",
            destinationPostalCode: "629564",
            destinationCountry: "SG",
            destinationPlaceId: "ChIJdest",
            destinationLat: 1.3136718,
            destinationLng: 103.6730866,
          }),
        ],
      }),
    );

    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        originLabel: "7 Gul Cir, 7 Gul Circle",
        originAddressLine1: "7 Gul Cir, 7 Gul Circle",
        originPostalCode: "629563",
        originCountry: "SG",
        destinationLabel: "8 Gul Cir, 8 Gul Circle",
        destinationAddressLine1: "8 Gul Cir, 8 Gul Circle",
        destinationPostalCode: "629564",
        destinationCountry: "SG",
      }),
    });
  });

  it("driver trip rate options for ops come from trucking dataset rows", async () => {
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({ id: "ds-trucking" }),
      },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "tm1",
            code: "TRIP-A",
            label: "Trip A",
            rateCents: 8000,
            currency: "SGD",
            isActive: true,
            hasMultipleRates: false,
            requiresManualAmount: false,
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const rows = await svc.listDriverTripRateMasters("t1");

    expect(rows).toEqual([
      {
        id: "tm1",
        code: "TRIP-A",
        label: "Trip A",
        rateCents: 8000,
        currency: "SGD",
        isActive: true,
        hasMultipleRates: false,
        requiresManualAmount: false,
      },
    ]);
    expect(prisma.masterRateDatasetRow.findMany).toHaveBeenCalled();
  });

  it("billing charge options do not fall back to the tenant quotation base", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: null,
          status: "ONGOING",
          charges: [],
        }),
      },
      customerRateTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      customerQuotation: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      masterRateDatasetRow: {
        findMany: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });

    expect(result.quotationSource).toBe("NONE");
    expect(result.quotationLines).toEqual([]);
    expect(result.acceptedQuotations).toEqual([]);
    expect(prisma.masterRateDataset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "DHC_RATES" }),
      }),
    );
  });

  it("exposes all accepted customer quotation catalogues when no legacy rate template exists", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: null,
          status: "ONGOING",
          charges: [],
        }),
      },
      customerQuotation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "q-accepted",
            quotationNo: "QT-202608-0007",
            title: "First quote",
            status: "ACCEPTED",
            customerCompanyId: "comp1",
            acceptedAt: new Date("2026-08-01"),
            validUntil: null,
          },
        ]),
      },
      customerQuotationLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "ql-1",
            code: "A",
            label: "Line A",
            unitPriceCents: 10000,
            currency: "SGD",
            requiresManualAmount: false,
            qty: 1,
          },
        ]),
      },
      customerRateTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      masterRateDatasetRow: {
        findMany: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });

    expect(result.quotationSource).toBe("CUSTOMER_QUOTATION");
    expect(result.boundQuotation).toBeNull();
    expect(result.acceptedQuotations).toHaveLength(1);
    expect(result.acceptedQuotations[0]?.id).toBe("q-accepted");
    expect(result.quotationLines).toHaveLength(1);
    expect(prisma.customerQuotation.findMany).toHaveBeenCalled();
  });

  it("does not expose draft quotations as charge options", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: null,
          status: "ONGOING",
          charges: [],
        }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      customerRateTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      masterRateDatasetRow: {
        findMany: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });

    expect(result.quotationSource).toBe("NONE");
    expect(result.quotationLines).toEqual([]);
  });

  it("billing charge options resolve DHC refs from tenant DHC dataset with fixed/multiple/manual states", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: null,
          status: "ONGOING",
          charges: [],
        }),
      },
      customerRateTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      customerQuotation: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({ id: "ds-dhc" }),
      },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
            {
              id: "d-fixed",
              code: "D1",
              label: "Fixed",
              rateCents: 8000,
              hasMultipleRates: false,
              requiresManualAmount: false,
            },
            {
              id: "d-multi",
              code: "D2",
              label: "Multi",
              rateCents: null,
              hasMultipleRates: true,
              rateOptionsJson: [
                { label: "Old", amountCents: 7000 },
                { label: "New", amountCents: 9000 },
              ],
              requiresManualAmount: false,
            },
            {
              id: "d-manual",
              code: "D3",
              label: "Manual",
              rateCents: null,
              hasMultipleRates: false,
              requiresManualAmount: true,
            },
          ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });

    expect(prisma.masterRateDatasetRow.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", datasetId: "ds-dhc", isActive: true },
      orderBy: { code: "asc" },
    });
    expect(result.dhcReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "d-fixed", rateCents: 8000, hasMultipleRates: false }),
        expect.objectContaining({ id: "d-multi", rateCents: null, hasMultipleRates: true }),
        expect.objectContaining({ id: "d-manual", rateCents: null, requiresManualAmount: true }),
      ]),
    );
  });

  it("IMPORT create with return location maps importDetails and generates two trips", async () => {
    const prisma: any = withCreateJobTransaction({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "JURONG" && where?.type === "PORT") {
            return Promise.resolve({ code: "JURONG", name: "Jurong Port", type: "PORT" });
          }
          if (where?.code === "GUL_DEFAULT" && where?.type === "DEPOT") {
            return Promise.resolve({
              id: "loc-gul",
              code: "GUL_DEFAULT",
              name: "Gul Depot",
              addressLine1: "7 Gul Circle",
              addressLine2: null,
              postalCode: "629563",
              placeId: null,
              lat: null,
              lng: null,
              type: "DEPOT",
              isActive: true,
            });
          }
          return Promise.resolve(null);
        }),
      },
      masterSingaporeDepot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      masterSingaporePort: {
        findFirst: jest.fn().mockResolvedValue({ code: "JURONG" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-IMP",
          externalRef: null,
          jobType: JobType.IMPORT,
          status: "ONGOING",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Jurong Port",
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress1: "Addr",
          deliveryAddress2: null,
          deliveryPostal: null,
          receiverName: "Receiver",
          receiverPhone: "123",
          assignedDriverId: null,
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
          assignedVehiclePlateNo: null,
          assignedAt: null,
          startedAt: null,
          completedAt: null,
          deliveredAt: null,
          podRecipientName: null,
          cancelledReason: null,
          cancelledAt: null,
          cancelledByUserId: null,
          lastLat: null,
          lastLng: null,
          lastLocationAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-IMP",
          externalRef: null,
          jobType: JobType.IMPORT,
          status: "ONGOING",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Jurong Port",
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress1: "Addr",
          deliveryAddress2: null,
          deliveryPostal: null,
          receiverName: "Receiver",
          receiverPhone: "123",
          assignedDriverId: null,
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
          assignedVehiclePlateNo: null,
          assignedAt: null,
          startedAt: null,
          completedAt: null,
          deliveredAt: null,
          podRecipientName: null,
          cancelledReason: null,
          cancelledAt: null,
          cancelledByUserId: null,
          lastLat: null,
          lastLng: null,
          lastLocationAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});

    await svc.create(
      "t1",
      {
        jobType: JobType.IMPORT,
        customerCompanyId: "comp1",
        pickupDate: "2026-04-24",
        pickupAddress1: "Jurong Port",
        deliveryAddress1: "Addr",
        receiverName: "Receiver",
        receiverPhone: "123",
        items: [{ itemCode: "BOX", qty: 1 }],
        importDetails: {
          pickupPortCode: "JURONG",
          portName: "Jurong Port",
          returningDepotCode: "GUL_DEFAULT",
        },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.pickupPortCode).toBe("JURONG");
    expect(data.portName).toBe("Jurong Port");
    expect(data.returningDepotCode).toBe("GUL_DEFAULT");
    expect(prisma.trip.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("IMPORT create without return depot auto-pends empty-return Draft Trips", async () => {
    const prisma: any = withCreateJobTransaction({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockResolvedValue({ code: "JURONG", name: "Jurong Port", type: "PORT" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          jobType: JobType.IMPORT,
          customerCompany: { id: "comp1", name: "Customer A" },
          items: [],
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          jobType: JobType.IMPORT,
          status: "ONGOING",
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          createdBy: null,
          items: [],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.IMPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "Jurong Port",
          deliveryAddress1: "Addr",
          receiverName: "Receiver",
          receiverPhone: "123",
          importDetails: { pickupPortCode: "JURONG" },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).resolves.toBeTruthy();
    expect(prisma.job.create).toHaveBeenCalled();
    expect(prisma.job.create.mock.calls[0][0].data.returningDepotPending).toBe(true);
  });

  it("IMPORT create with return depot address generates two trips and stores null returningDepotCode", async () => {
    const prisma: any = withCreateJobTransaction({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockResolvedValue({ code: "JURONG", name: "Jurong Port", type: "PORT" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          jobType: JobType.IMPORT,
          customerCompany: { id: "comp1", name: "Customer A" },
          items: [],
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          jobType: JobType.IMPORT,
          status: "ONGOING",
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          createdBy: null,
          items: [],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);

    await svc.create(
      "t1",
      {
        jobType: JobType.IMPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "Jurong Port",
        deliveryAddress1: "Addr",
        receiverName: "Receiver",
        receiverPhone: "123",
        importDetails: {
          pickupPortCode: "JURONG",
          returningDepotAddress1: "Tuas Depot",
        },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.returningDepotCode).toBeNull();
    expect(prisma.trip.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("create job accepts nested exportDetails and maps export routing fields", async () => {
    const prisma: any = withCreateJobTransaction({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "PSA_DEPOT_A" && where?.type === "DEPOT") {
            return Promise.resolve({ code: "PSA_DEPOT_A", name: "PSA Depot A", type: "DEPOT" });
          }
          if (where?.code === "PSA_DEPOT_B" && where?.type === "DEPOT") {
            return Promise.resolve({ code: "PSA_DEPOT_B", name: "PSA Depot B", type: "DEPOT" });
          }
          return Promise.resolve(null);
        }),
      },
      masterSingaporeDepot: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ code: "PSA_DEPOT_A" })
          .mockResolvedValueOnce({ code: "PSA_DEPOT_B" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-EXP",
          externalRef: null,
          jobType: JobType.EXPORT,
          status: "ONGOING",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Pickup A1",
          deliveryAddress1: "Stuffing A1",
          receiverName: "Stuffing PIC",
          receiverPhone: "99999999",
          assignedDriverId: null,
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
          assignedVehiclePlateNo: null,
          assignedAt: null,
          startedAt: null,
          completedAt: null,
          deliveredAt: null,
          podRecipientName: null,
          cancelledReason: null,
          cancelledAt: null,
          cancelledByUserId: null,
          lastLat: null,
          lastLng: null,
          lastLocationAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-EXP",
          externalRef: null,
          jobType: JobType.EXPORT,
          status: "ONGOING",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Pickup A1",
          deliveryAddress1: "Stuffing A1",
          receiverName: "Stuffing PIC",
          receiverPhone: "99999999",
          assignedDriverId: null,
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
          assignedVehiclePlateNo: null,
          assignedAt: null,
          startedAt: null,
          completedAt: null,
          deliveredAt: null,
          podRecipientName: null,
          cancelledReason: null,
          cancelledAt: null,
          cancelledByUserId: null,
          lastLat: null,
          lastLng: null,
          lastLocationAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupDate: "2026-04-24",
        pickupAddress1: "Pickup A1",
        deliveryAddress1: "Stuffing A1",
        receiverName: "Legacy receiver",
        receiverPhone: "123",
        items: [{ itemCode: "BOX", qty: 1 }],
        exportDetails: {
          pickupDepotCode: "PSA_DEPOT_A",
          containerPickupAddress1: "Pickup A1",
          stuffingAddress1: "Stuffing A1",
          stuffingContactName: "Stuffing PIC",
          stuffingContactPhone: "99999999",
          returnDepotCode: "PSA_DEPOT_B",
          exportPortCode: "PSA",
        },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.exportOriginDepotCode).toBe("PSA_DEPOT_A");
    expect(data.returningDepotCode).toBeNull();
    expect(data.exportPortCode).toBe("PSA");
    expect(data.pickupAddress1).toBe("Pickup A1");
    expect(data.deliveryAddress1).toBe("Stuffing A1");
    expect(data.receiverName).toBe("Stuffing PIC");
    expect(data.receiverPhone).toBe("99999999");
    expect(prisma.trip.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(prisma.trip.createMany.mock.calls[0][0].data[0].jobTripTemplate).toBe(
      "DELIVERY_TO_PORT",
    );
  });

  it("invoice draft from jobs uses saved JobCharge rows and fails if any selected job has none", async () => {
    const prisma: any = {
      job: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: "j1",
              internalRef: "JOB-1",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [
                {
                  label: "Haulage",
                  qty: 1,
                  unitPriceCents: 10000,
                  taxable: true,
                  taxCode: "SR",
                  taxRateBasisPoints: 900,
                },
              ],
            },
            {
              id: "j2",
              internalRef: "JOB-2",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [
                {
                  label: "Surcharge",
                  qty: 2,
                  unitPriceCents: 5000,
                  taxable: false,
                  taxCode: null,
                  taxRateBasisPoints: null,
                },
              ],
            },
          ])
          .mockResolvedValueOnce([
            {
              id: "j1",
              internalRef: "JOB-1",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [
                {
                  label: "Haulage",
                  qty: 1,
                  unitPriceCents: 10000,
                  taxable: true,
                  taxCode: "SR",
                  taxRateBasisPoints: 900,
                },
              ],
            },
            {
              id: "j2",
              internalRef: "JOB-2",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [],
            },
          ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new InvoicesService(prisma, supabaseService, audit);

    const ok = await svc.getInvoiceDraftFromJobs(
      "t1",
      ["j1", "j2"],
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(ok.sourceJobIds).toEqual(["j1", "j2"]);
    expect(ok.suggestedLineItems).toEqual([
      expect.objectContaining({
        description: "JOB-1 — Haulage",
        qty: 1,
        unitPriceCents: 10000,
        taxCode: "SR",
        taxRate: 900,
        sourceType: "JOB",
        sourceJobId: "j1",
      }),
      expect.objectContaining({
        description: "JOB-2 — Surcharge",
        qty: 2,
        unitPriceCents: 5000,
        taxCode: "ZR",
        taxRate: 0,
        sourceType: "JOB",
        sourceJobId: "j2",
      }),
    ]);

    await expect(
      svc.getInvoiceDraftFromJobs("t1", ["j1", "j2"], {
        userId: "u1",
        role: Role.TRANSPORT_STAFF,
      }),
    ).rejects.toThrow(
      "Selected jobs must have saved JobCharge rows before invoicing. Missing charges for: JOB-2",
    );
  });

  it("publishTrip fails when DRAFT trip has no payout assigned", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: null,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
        }),
        update: jest.fn(),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow("Set driver payout before publishing trip.");
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("publishTrip moves DRAFT trip to PUBLISHED when payout exists", async () => {
    const prisma: any = withJobInvoiceSyncMocks({
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: 7500,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
        }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF });

    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ status: "PUBLISHED", pendingState: "NONE" }),
    });
  });

  it("publishTrip fails when payout lines require manual amount", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: 7500,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
        }),
        update: jest.fn(),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl1",
            label: "Manual line",
            isSelectableForTripEarning: true,
            requiresManualAmount: true,
            amountCents: null,
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow('Payout line "Manual line" requires manual amount before publish');
  });

  it("publishTrip succeeds when payout lines total is positive", async () => {
    const prisma: any = withJobInvoiceSyncMocks({
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: null,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
        }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl1",
            label: "Line 1",
            isSelectableForTripEarning: true,
            requiresManualAmount: false,
            quantity: 1,
            amountCents: 1500,
            totalCents: 1500,
          },
          {
            id: "pl2",
            label: "Line 2",
            isSelectableForTripEarning: true,
            requiresManualAmount: false,
            quantity: 1,
            amountCents: 2000,
            totalCents: 2000,
          },
        ]),
      },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF });
    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ status: "PUBLISHED" }),
    });
  });

  it("publishTrip allows manual payout line when amount and total are positive", async () => {
    const prisma: any = withJobInvoiceSyncMocks({
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: null,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
        }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl-manual",
            label: "hjhjhj",
            isManual: true,
            quantity: 1,
            amountCents: 6700,
            totalCents: 6700,
          },
        ]),
      },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).resolves.toBeTruthy();
  });

  it("publishTrip rejects manual payout line when amountCents is null", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: null,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
        }),
        update: jest.fn(),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl-manual",
            label: "hjhjhj",
            isManual: true,
            quantity: 1,
            amountCents: null,
            totalCents: 6700,
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow('Payout line "hjhjhj" requires manual amount before publish');
  });

  it("publishTrip rejects manual payout line when amountCents is 0", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: null,
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
        }),
        update: jest.fn(),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl-manual",
            label: "hjhjhj",
            isManual: true,
            quantity: 1,
            amountCents: 0,
            totalCents: 6700,
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow('Payout line "hjhjhj" requires manual amount before publish');
  });

  it("publishTrip fails without driver assignment", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: 7500,
          assignedDriverUserId: null,
          driverId: null,
          vehicleId: null,
          fleetVehicleId: null,
        }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow("Assign driver before publishing trip.");
  });

  it("publishTrip succeeds without Collection Docs when assignment and earning exist", async () => {
    const prisma: any = withJobInvoiceSyncMocks({
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: 7500,
          assignedDriverUserId: "u1",
          driverId: "d1",
          vehicleId: "v1",
          fleetVehicleId: null,
          containerNumber: null,
        }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
      tripPayoutLine: { findMany: jest.fn().mockResolvedValue([]) },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          jobType: "LCL",
          items: [],
        }),
      },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).resolves.toBeTruthy();
  });

  it("sendJobToInvoice syncs ONGOING job to READY_FOR_INVOICE when trips are complete", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
        }),
        update: jest.fn(),
      },
      trip: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { id: "t1", status: "DONE" },
          { id: "t2", status: "DONE" },
        ]),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({
      id: "job1",
      status: "READY_FOR_INVOICE",
      isInvoiceReady: true,
    } as any);

    const result = await svc.sendJobToInvoice("t1", "job1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });

    expect(result).toMatchObject({
      readyForInvoice: true,
      alreadyReady: false,
      message: "Job is ready for invoice",
    });
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: {
        status: "READY_FOR_INVOICE",
        invoiceReadyAt: expect.any(Date),
      },
    });
  });

  it("sendJobToInvoice rejects when trips are not complete", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
        }),
        update: jest.fn(),
      },
      trip: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ id: "t1", status: "ONGOING" }]),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.sendJobToInvoice("t1", "job1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow("All non-cancelled trips must be completed or done before invoicing.");
  });

  it("sendJobToInvoice allows COMPLETED/DONE + CANCELLED trips", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
        }),
        update: jest.fn(),
      },
      trip: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([
          { id: "t1", status: "COMPLETED" },
          { id: "t2", status: "DONE" },
          { id: "t3", status: "CANCELLED" },
        ]),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    const result = await svc.sendJobToInvoice("t1", "job1", {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });
    expect(result.readyForInvoice).toBe(true);
  });

  it("sendJobToInvoice rejects all-cancelled jobs with clear reason", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
        }),
        update: jest.fn(),
      },
      trip: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { id: "t1", status: "CANCELLED" },
          { id: "t2", status: "CANCELLED" },
        ]),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.sendJobToInvoice("t1", "job1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow("No completed trips available for invoicing.");
  });

  it.each(["PUBLISHED", "DRAFT", "ONGOING"] as const)(
    "sendJobToInvoice blocks non-cancelled %s trips",
    async (blockingStatus) => {
      const prisma: any = {
        job: {
          findFirst: jest.fn().mockResolvedValue({
            id: "job1",
            status: "ONGOING",
            invoiceReadyAt: null,
          }),
          update: jest.fn(),
        },
        trip: {
          count: jest.fn().mockResolvedValue(3),
          findMany: jest.fn().mockResolvedValue([
            { id: "t1", status: "COMPLETED" },
            { id: "t2", status: blockingStatus },
            { id: "t3", status: "CANCELLED" },
          ]),
        },
        invoice: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const supabaseService = { getClient: jest.fn() } as any;
      const svc = new TransportJobsService(prisma, audit, supabaseService);

      await expect(
        svc.sendJobToInvoice("t1", "job1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
      ).rejects.toThrow("All non-cancelled trips must be completed or done before invoicing.");
    },
  );

  it("markTripDone promotes job to READY_FOR_INVOICE when all non-cancelled trips are completed/done", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "trip1", status: "COMPLETED" })
          .mockResolvedValueOnce({ status: "ONGOING" }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
        findMany: jest.fn().mockResolvedValue([
          { status: "DONE" },
          { status: "CANCELLED" },
        ]),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.markTripDone("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF });

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job1" },
        data: {
          status: "READY_FOR_INVOICE",
          invoiceReadyAt: expect.any(Date),
        },
      }),
    );
  });

  it("markTripDone treats COMPLETED + CANCELLED mix as invoice-ready", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "trip1", status: "COMPLETED" })
          .mockResolvedValueOnce({ status: "ONGOING" }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
        findMany: jest.fn().mockResolvedValue([
          { status: "COMPLETED" },
          { status: "CANCELLED" },
        ]),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.markTripDone("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF });

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job1" },
        data: {
          status: "READY_FOR_INVOICE",
          invoiceReadyAt: expect.any(Date),
        },
      }),
    );
  });

  it("issueInvoice completes a job only when every JobCharge is on a recognized invoice", async () => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          invoiceNo: "INV-202604-0001",
          customerName: "Customer A",
          currency: "SGD",
          issueDate: new Date("2026-04-29T00:00:00.000Z"),
          dueDate: null,
          notes: null,
          subtotalCents: 1000,
          taxCents: 90,
          totalCents: 1090,
          status: "GENERATED",
          pdfKey: "invoices/inv1.pdf",
          pdfGeneratedAt: new Date("2026-04-29T00:30:00.000Z"),
          snapshot: { orderIds: [], sourceJobIds: ["job1"] },
          lineItems: [{ jobChargeId: "jc1" }],
        }),
        update: jest.fn().mockResolvedValue({
          id: "inv1",
          invoiceNo: "INV-202604-0001",
          customerName: "Customer A",
          currency: "SGD",
          issueDate: new Date("2026-04-29T00:00:00.000Z"),
          dueDate: null,
          notes: null,
          subtotalCents: 1000,
          taxCents: 90,
          totalCents: 1090,
          status: "ISSUED",
          snapshot: { orderIds: [], sourceJobIds: ["job1"] },
          lineItems: [{ jobChargeId: "jc1" }],
          orders: [],
          issuedAt: new Date("2026-04-29T01:00:00.000Z"),
          issuedByUserId: null,
          pdfKey: null,
          pdfGeneratedAt: null,
        }),
      },
      transportOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      invoiceLineItem: { findMany: jest.fn().mockResolvedValue([]) },
      invoiceChargeReservation: {
        findMany: jest.fn().mockImplementation((args: any) => {
          if (args?.where?.invoiceId?.not) return [];
          return [{ jobChargeId: "jc1", invoice: { status: "ISSUED" } }];
        }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "jc1",
            jobId: "job1",
            label: "Haulage",
            job: {
              id: "job1",
              internalRef: "JOB-1",
              status: "READY_FOR_INVOICE",
              invoiceReadyAt: new Date(),
              customerCompanyId: "comp1",
              sourceCustomerQuotationId: null,
            },
          },
        ]),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job1",
            status: "READY_FOR_INVOICE",
            invoiceReadyAt: new Date(),
            charges: [{ id: "jc1" }],
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new InvoicesService(prisma, supabaseService, audit);

    await svc.issueInvoice("t1", "inv1", { userId: "u1", role: Role.TRANSPORT_STAFF });

    expect(tx.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job1" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("requires manual amount when quotation line is marked requiresManualAmount", async () => {
    const jobChargeDeleteMany = jest.fn().mockResolvedValue({});
    const jobChargeCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: "q-accepted",
          status: "ONGOING",
        }),
      },
      $transaction: jest.fn(async (input: any) => {
        if (typeof input === "function") {
          return input({
            customerQuotationLine: {
              findMany: jest.fn().mockResolvedValue([
                {
                  id: "ql-manual",
                  label: "Season Parking",
                  requiresManualAmount: true,
                  quotation: {
                    id: "q-accepted",
                    quotationNo: "QT-1",
                    title: null,
                    status: "ACCEPTED",
                    customerCompanyId: "comp1",
                  },
                },
              ]),
            },
            customerRateTemplateRow: { findMany: jest.fn().mockResolvedValue([]) },
            jobCharge: {
              findMany: jest.fn().mockResolvedValue([]),
              deleteMany: jobChargeDeleteMany,
              createMany: jobChargeCreateMany,
            },
            invoiceChargeReservation: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          });
        }
        return Promise.all(input);
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.saveJobCharges(
        "t1",
        "job1",
        {
          charges: [
            {
              sourceType: "CUSTOMER_QUOTATION",
              sourceCustomerQuotationLineId: "ql-manual",
              sourceRefId: "ql-manual",
              code: "E-1",
              label: "Season Parking",
              qty: 1,
              unitPriceCents: 0,
            },
          ],
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(
      'Manual amount is required for quotation item "Season Parking" before saving charges',
    );
    expect(jobChargeDeleteMany).toHaveBeenCalled();
    expect(jobChargeCreateMany).not.toHaveBeenCalled();
  });

  it("patchTrip accepts valid selectable DRIVER_PAYOUT item id and updates earning", async () => {
    const tripFindFirst = jest.fn().mockResolvedValue({
      id: "trip1",
      tenantId: "t1",
      jobId: "job1",
    });
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: tripFindFirst,
        update: tripUpdate,
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "cmo946tmb0001ku5ekac6in1g",
          label: "Normal full trip (20FT and 40FT)",
          rateCents: 9000,
          requiresManualAmount: false,
        }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      { earningRateMasterId: "cmo946tmb0001ku5ekac6in1g" } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        payoutItemId: "cmo946tmb0001ku5ekac6in1g",
        earningRateMasterId: null,
        driverEarningCents: 9000,
      }),
    });
  });

  it("patchTrip fails when earningRateMasterId is a masterFile id", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: jest.fn(),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "master_file_id_123" } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow("Driver trip rate master not found");
  });

  it("patchTrip fails for inactive or non-selectable payout item", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: jest.fn(),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "inactive_or_nonselectable_item" } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow("Driver trip rate master not found");
  });

  it("patchTrip rejects selectable payout item requiring manual amount", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: jest.fn(),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "item-manual",
          label: "Manual",
          rateCents: null,
          requiresManualAmount: true,
        }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "item-manual" } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(
      'Selected payout item "Manual" requires manual amount before assignment',
    );
  });

  it("patchTrip accepts plannedStartAt and records updatedByUserId with changedFields", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: tripUpdate,
      },
    };
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      { plannedStartAt: "2026-04-27T09:00:00.000Z" } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        plannedStartAt: new Date("2026-04-27T09:00:00.000Z"),
        updatedByUserId: "u1",
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "TRIP_UPDATE",
      "JOB",
      "job1",
      expect.objectContaining({
        tripId: "trip1",
        changedFields: expect.arrayContaining(["plannedStartAt"]),
      }),
      "u1",
    );
  });

  it("patchTrip accepts origin and destination object snapshots", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: tripUpdate,
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      {
        origin: {
          label: "Origin A",
          addressLine1: "Addr 1",
          addressLine2: "Addr 2",
          postalCode: "123456",
          country: "SG",
          lat: 1.23,
          lng: 103.45,
          placeId: "place-origin",
          locationId: "loc-origin",
        },
        destination: {
          label: "Destination B",
          addressLine1: "D Addr 1",
          addressLine2: null,
          postalCode: "654321",
          country: "SG",
          lat: 1.67,
          lng: 103.89,
          placeId: "place-destination",
          locationId: "loc-destination",
        },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        originLabel: "Origin A",
        originAddressLine1: "Addr 1",
        originAddressLine2: "Addr 2",
        originPostalCode: "123456",
        originCountry: "SG",
        originLat: 1.23,
        originLng: 103.45,
        originPlaceId: "place-origin",
        originLocationId: "loc-origin",
        destinationLabel: "Destination B",
        destinationAddressLine1: "D Addr 1",
        destinationAddressLine2: null,
        destinationPostalCode: "654321",
        destinationCountry: "SG",
        destinationLat: 1.67,
        destinationLng: 103.89,
        destinationPlaceId: "place-destination",
        destinationLocationId: "loc-destination",
      }),
    });
  });

  it("patchTrip keeps plannedDate and summary aliases supported", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: tripUpdate,
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      {
        plannedDate: "2026-05-01",
        originSummary: "Origin Summary",
        destinationSummary: "Destination Summary",
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        plannedStartAt: new Date("2026-05-01T00:00:00.000Z"),
        originLabel: "Origin Summary",
        destinationLabel: "Destination Summary",
      }),
    });
  });

  it("patchTrip rejects lifecycle status mutation via generic edit endpoint", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { status: "DONE" } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow("Trip status cannot be changed from PATCH /jobs/:jobId/trips/:tripId");
  });

  it.each(["DRAFT", "PUBLISHED", "ONGOING", "COMPLETED", "DONE"])(
    "assignTrip allows reassignment at %s status",
    async (status) => {
      const prisma: any = {
        trip: {
          findFirst: jest.fn().mockResolvedValue({
            id: "trip1",
            tenantId: "t1",
            jobId: "job1",
            status,
            assignedDriverUserId: "old-driver",
          }),
          update: jest.fn().mockResolvedValue({ id: "trip1" }),
        },
        tenantMembership: {
          findFirst: jest.fn().mockResolvedValue({ userId: "new-driver" }),
          findMany: jest.fn().mockResolvedValue([
            { userId: "old-driver", user: { id: "old-driver", name: "Old Driver", email: "old@example.com" } },
            { userId: "new-driver", user: { id: "new-driver", name: "New Driver", email: "new@example.com" } },
          ]),
        },
        drivers: {
          findFirst: jest.fn().mockResolvedValue({
            id: "driver-row",
            assignedVehicleId: "vehicle-1",
            assignedFleetVehicleId: null,
          }),
        },
        vehicle: {
          findFirst: jest.fn().mockResolvedValue({ id: "vehicle-1", type: "TRAILER" }),
        },
        fleetVehicle: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const supabaseService = { getClient: jest.fn() } as any;
      const svc = new TransportJobsService(prisma, audit, supabaseService);
      jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

      await expect(
        svc.assignTrip(
          "t1",
          "job1",
          "trip1",
          { driverId: "new-driver", vehicleType: "TRAILER" } as any,
          { userId: "ops-1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();
      expect(prisma.trip.update).toHaveBeenCalledWith({
        where: { id: "trip1" },
        data: expect.objectContaining({
          assignedDriverUserId: "new-driver",
          updatedByUserId: "ops-1",
          assignedByUserId: "ops-1",
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        "t1",
        "TRIP_DRIVER_REASSIGNED",
        "TRIP",
        "trip1",
        expect.objectContaining({
          oldDriverUserId: "old-driver",
          newDriverUserId: "new-driver",
        }),
        "ops-1",
      );
    },
  );

  it("rejects non-NONE pending state when trip is COMPLETED", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "COMPLETED" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.updateTripPendingState(
        "t1",
        "job1",
        "trip1",
        "PENDING_AT_PORT" as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(
      'pendingState "PENDING_AT_PORT" is invalid when trip status is COMPLETED. Allowed only for PUBLISHED or ONGOING',
    );
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("rejects non-NONE pending state when trip is DRAFT", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "DRAFT" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.updateTripPendingState(
        "t1",
        "job1",
        "trip1",
        "PENDING_AT_DEPOT" as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(
      'pendingState "PENDING_AT_DEPOT" is invalid when trip status is DRAFT. Allowed only for PUBLISHED or ONGOING',
    );
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("rejects non-NONE pending state when trip is DONE", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "DONE" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.updateTripPendingState(
        "t1",
        "job1",
        "trip1",
        "PENDING_AT_PORT" as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(
      'pendingState "PENDING_AT_PORT" is invalid when trip status is DONE. Allowed only for PUBLISHED or ONGOING',
    );
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("markTripDone auto-clears pendingState to NONE", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "COMPLETED" }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      job: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "job1", status: "ONGOING" }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.markTripDone("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF });

    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: { status: "DONE", pendingState: "NONE" },
    });
  });

  it("getTripDetail maps IMPORT cargo as CONTAINER with containerNumber", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          jobSequence: 3,
          tripSequence: 3,
          title: "Trip A",
          displayTitle: "Trip A",
          status: "PUBLISHED",
          pendingState: "NONE",
          plannedStartAt: null,
          startedAt: null,
          closedAt: null,
          createdAt: new Date(),
          createdByUserId: "u1",
          publishedAt: new Date(),
          publishedByUserId: "u1",
          assignedDriverUserId: "u1",
          vehicleId: null,
          fleetVehicleId: null,
          vehicles: null,
          fleetVehicle: null,
          documents: [],
          payoutLines: [],
          documentRequirements: [],
          completionRuleJson: null,
          driverEarningCents: null,
          earningRateMasterId: null,
          originLabel: "Port",
          destinationLabel: "Destination",
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-2026-04-0002-IMP",
            externalRef: null,
            jobType: "IMPORT",
            status: "ONGOING",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer A" },
            items: [{ id: "it1", itemCode: "CONT-001", description: "20FT", sealNo: "SEAL-A", qty: 1 }],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
      drivers: { findFirst: jest.fn().mockResolvedValue({ hasPsaPortAccess: false }) },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "link1",
            jobItemId: "it1",
            containerNumberSnapshot: "CONT-001",
            jobItem: {
              id: "it1",
              itemCode: "CONT-001",
              description: "20FT",
              sealNo: "SEAL-A",
              pickupReference: null,
              qty: 1,
            },
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.cargo.containers[0].containerNumber).toBe("CONT-001");
    expect(result.cargo.containers[0].sealNo).toBe("SEAL-A");
    expect(result.job.customerCompanyName).toBe("Customer A");
    expect(result.tripDisplayRef).toBe("WF-0002-IMP-T03");
  });

  it("getTripDetail maps EXPORT cargo as CONTAINER with containerNumber", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          pendingState: "NONE",
          createdAt: new Date(),
          documents: [],
          payoutLines: [],
          documentRequirements: [],
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-002",
            externalRef: null,
            jobType: "EXPORT",
            status: "ONGOING",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer B" },
            items: [{ id: "it1", itemCode: "CONT-EXP-01", description: null, qty: 1 }],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
      drivers: { findFirst: jest.fn().mockResolvedValue({ hasPsaPortAccess: false }) },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "link1",
            jobItemId: "it1",
            containerNumberSnapshot: "CONT-EXP-01",
            jobItem: {
              id: "it1",
              itemCode: "CONT-EXP-01",
              description: null,
              sealNo: null,
              pickupReference: null,
              qty: 1,
            },
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.cargo.containers[0].containerNumber).toBe("CONT-EXP-01");
  });

  it("getTripDetail maps LCL cargo as ITEMS with itemCode and publish metadata", async () => {
    const now = new Date();
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          pendingState: "NONE",
          createdAt: now,
          createdByUserId: "u1",
          updatedByUserId: "u3",
          publishedAt: now,
          publishedByUserId: "u2",
          assignedAt: now,
          assignedByUserId: "u2",
          payoutItemId: "cmo946tmb0001ku5ekac6in1g",
          earningRateMasterId: null,
          documents: [],
          payoutLines: [],
          documentRequirements: [],
          assignedDriverUserId: null,
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-003",
            externalRef: null,
            jobType: "LCL",
            status: "ONGOING",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: now,
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
            customerCompany: { name: "Customer C" },
            items: [{ id: "it1", itemCode: "ITEM-001", description: "Box", qty: 3 }],
          },
        }),
      },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "u1", user: { id: "u1", name: "Ops User", email: "ops@example.com" } },
          { userId: "u2", user: { id: "u2", name: "Publisher", email: "pub@example.com" } },
          { userId: "u3", user: { id: "u3", name: "Updater", email: "update@example.com" } },
        ]),
      },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
      drivers: { findFirst: jest.fn().mockResolvedValue({ hasPsaPortAccess: false }) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
    expect(result.cargo.mode).toBe("ITEMS");
    expect(result.cargo.items[0].itemCode).toBe("ITEM-001");
    expect(result.createdByName).toBe("Ops User");
    expect(result.publishedByName).toBe("Publisher");
    expect(result.updatedByName).toBe("Updater");
    expect(result.publishedAt).toEqual(now);
    expect(result.payout.earningRateMasterId).toBe("cmo946tmb0001ku5ekac6in1g");
  });

  it("getTripDetail canPublish is false when publishTrip would fail readiness", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "DRAFT",
          pendingState: "NONE",
          createdAt: new Date(),
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
          documents: [],
          payoutLines: [
            {
              id: "pl1",
              label: "Manual line",
              isManual: true,
              quantity: 1,
              amountCents: null,
              totalCents: 6700,
            },
          ],
          documentRequirements: [],
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-004",
            externalRef: null,
            jobType: "LCL",
            status: "ONGOING",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer D" },
            items: [],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
      drivers: { findFirst: jest.fn().mockResolvedValue({ hasPsaPortAccess: false }) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
    expect(result.canPublish).toBe(false);
  });

  it("getTripDetail canPublish is true when publishTrip readiness is satisfied", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "DRAFT",
          pendingState: "NONE",
          createdAt: new Date(),
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
          documents: [],
          payoutLines: [
            {
              id: "pl1",
              label: "hjhjhj",
              isManual: true,
              quantity: 1,
              amountCents: 6700,
              totalCents: 6700,
            },
          ],
          documentRequirements: [],
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-005",
            externalRef: null,
            jobType: "LCL",
            status: "ONGOING",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer E" },
            items: [],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
      drivers: { findFirst: jest.fn().mockResolvedValue({ hasPsaPortAccess: false }) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
    expect(result.canPublish).toBe(true);
  });

  it("getTripDetail canPublish is true for IMPORT empty-return when trip destination is set", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip2",
          tenantId: "t1",
          jobId: "job1",
          status: "DRAFT",
          pendingState: "NONE",
          createdAt: new Date(),
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
          jobTripTemplate: "DELIVERY_TO_DEPOT",
          destinationAddressLine1: "7 Gul Circle",
          documents: [],
          payoutLines: [
            {
              id: "pl1",
              label: "Trip payout",
              isManual: true,
              quantity: 1,
              amountCents: 1800,
              totalCents: 1800,
            },
          ],
          documentRequirements: [],
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WFL-0003-IMP",
            externalRef: null,
            jobType: "IMPORT",
            status: "ONGOING",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer F" },
            items: [{ id: "it1", itemCode: "OOCU9212981", sealNo: "X" }],
          },
        }),
      },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([
          { jobItemId: "it1", jobItem: { id: "it1", itemCode: "OOCU9212981" } },
        ]),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
      drivers: { findFirst: jest.fn().mockResolvedValue({ hasPsaPortAccess: false }) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip2", { role: Role.TRANSPORT_STAFF });
    expect(result.canPublish).toBe(true);
  });

  it("getTripDetail canPublish is false when multi-container IMPORT has no TripJobItem links", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "DRAFT",
          pendingState: "NONE",
          createdAt: new Date(),
          assignedDriverUserId: "u1",
          vehicleId: "v1",
          fleetVehicleId: null,
          documents: [],
          payoutLines: [
            {
              id: "pl1",
              label: "Trip payout",
              isManual: true,
              quantity: 1,
              amountCents: 6700,
              totalCents: 6700,
            },
          ],
          documentRequirements: [],
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-006",
            externalRef: null,
            jobType: "IMPORT",
            status: "ONGOING",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer F" },
            items: [
              { id: "it1", itemCode: "CONT1", sealNo: null },
              { id: "it2", itemCode: "CONT2", sealNo: null },
            ],
          },
        }),
      },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
      drivers: { findFirst: jest.fn().mockResolvedValue({ hasPsaPortAccess: false }) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
    expect(result.canPublish).toBe(false);
  });

  it("publishTrip blocks multi-container IMPORT without TripJobItem links", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "DRAFT",
          assignedDriverUserId: "u1",
          driverId: null,
          vehicleId: "v1",
          fleetVehicleId: null,
          driverEarningCents: 5000,
          containerNumber: null,
        }),
        update: jest.fn(),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl1",
            label: "Trip payout",
            isManual: true,
            quantity: 1,
            amountCents: 5000,
            totalCents: 5000,
          },
        ]),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          jobType: "IMPORT",
          items: [
            { id: "it1", itemCode: "CONT1" },
            { id: "it2", itemCode: "CONT2" },
          ],
        }),
      },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.TRANSPORT_STAFF }),
    ).rejects.toThrow(/jobItemIds|linked cargo|cargo item/i);
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("saveTripPayoutDraft saves one selected master payout line", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
        update: tripUpdate,
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "cmo946tmb0001ku5ekac6in1g",
          label: "Normal full trip (20FT and 40FT)",
          rateCents: 5000,
          requiresManualAmount: false,
        }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveTripPayoutDraft(
      "t1",
      "job1",
      "trip1",
      {
        earningRateMasterId: "cmo946tmb0001ku5ekac6in1g",
        payoutLines: [
          {
            sourceRateMasterItemId: "cmo946tmb0001ku5ekac6in1g",
            label: "Line 1",
            quantity: 1,
            amountCents: 5000,
            totalCents: 5000,
            isManual: false,
          } as any,
        ],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        payoutItemId: "cmo946tmb0001ku5ekac6in1g",
        earningRateMasterId: null,
        driverEarningCents: 5000,
      }),
    });
  });

  it("saveTripPayoutDraft snapshots TRUCKING_RATES onto payout-line earningRateMasterId without coupling Trip.earningRateMasterId", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const liveRow = {
      id: "trucking-row-a1",
      datasetId: "dataset-current",
      tenantId: "t1",
      code: "A-1",
      label: "Normal full trip",
      rateCents: 1800,
      requiresManualAmount: false,
      isActive: true,
    };
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "DRAFT",
        }),
        update: tripUpdate,
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany,
      },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({ id: "dataset-current" }),
      },
      masterRateDatasetRow: {
        findFirst: jest.fn().mockResolvedValue(liveRow),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveTripPayoutDraft(
      "t1",
      "job1",
      "trip1",
      {
        earningRateMasterId: "trucking-row-a1",
        payoutLines: [
          {
            sourceRateMasterItemId: "trucking-row-a1",
            code: "A-1",
            label: "Normal full trip",
            quantity: 1,
            amountCents: 1800,
            totalCents: 1800,
            isManual: false,
          } as any,
        ],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          earningRateMasterId: "trucking-row-a1",
          payoutItemId: null,
          amountCents: 1800,
          totalCents: 1800,
          code: "A-1",
          label: "Normal full trip",
        }),
      ],
    });
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        // Trip.earningRateMasterId FK is driver_trip_rate_masters, not dataset rows.
        earningRateMasterId: null,
        payoutItemId: null,
        driverEarningCents: 1800,
      }),
    });
    liveRow.rateCents = 9999;
    expect(createMany.mock.calls[0][0].data[0].amountCents).toBe(1800);
  });

  it("saveTripPayoutDraft supports multiple lines and sums total", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
        update: tripUpdate,
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveTripPayoutDraft(
      "t1",
      "job1",
      "trip1",
      {
        earningRateMasterId: null,
        payoutLines: [
          { label: "L1", quantity: 1, amountCents: 1000, totalCents: 1000, isManual: true } as any,
          { label: "L2", quantity: 2, amountCents: 2000, totalCents: 4000, isManual: true } as any,
        ],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ driverEarningCents: 5000 }),
    });
  });

  it("saveTripPayoutDraft supports manual line save", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
        update: jest.fn().mockResolvedValue({}),
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ label: "Manual", quantity: 1, amountCents: 1500, totalCents: 1500, isManual: true }] as any,
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).resolves.toBeTruthy();
  });

  it("saveTripPayoutDraft fails invalid sourceRateMasterItemId", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ sourceRateMasterItemId: "bad", label: "Bad", quantity: 1, amountCents: 1, totalCents: 1 }] as any,
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow("Invalid sourceRateMasterItemId");
  });

  it("saveTripPayoutDraft fails for non-selectable source item", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ sourceRateMasterItemId: "non-selectable", label: "Bad", quantity: 1, amountCents: 1, totalCents: 1 }] as any,
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow("Invalid sourceRateMasterItemId");
  });

  it("saveTripPayoutDraft requires amountCents for requiresManualAmount source item", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "manual-source",
          label: "Manual source",
          rateCents: null,
          requiresManualAmount: true,
        }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new TransportJobsService(prisma, audit, supabaseService);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ sourceRateMasterItemId: "manual-source", label: "Manual", quantity: 1, totalCents: 10 }] as any,
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow("requires amountCents");
  });
});
