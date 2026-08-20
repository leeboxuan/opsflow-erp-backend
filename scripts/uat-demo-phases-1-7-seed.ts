/**
 * Idempotent UAT demo seed for Phases 1–7 (Finance Statistics + Dispatch Route Planning).
 *
 * Safety:
 * - Loads opsflow-erp-backend/.env only (never .env.local)
 * - Stops if UAT Supabase ref rzvayccekcmkpwfyxuzi is not proven
 * - Mutates only records owned by prefix UAT-DEMO-PHASES-1-7
 * - No migrations / deploy / commit / push / cleanup
 */
import {
  CollectionType,
  InvoiceStatus,
  JobChargeSourceType,
  JobStatus,
  JobType,
  PrismaClient,
  Role,
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
  TripExpenseCategory,
  TripExpenseEventAction,
  TripExpensePaymentMethod,
  TripExpenseReimbursementStatus,
  TripExpenseReviewStatus,
  TripStatus,
} from "@prisma/client";
import { todayOperatingDate } from "../src/transport/dispatch/dispatch-day-bounds";
import {
  isDispatchSequenceLocked,
  mergeSuggestedWithLockedAbsolutePositions,
  PLANNING_EXCLUDED,
} from "../src/transport/dispatch/dispatch-sequence";
import { JobFinanceSummaryService } from "../src/transport/finance/job-finance-summary.service";
import {
  driverMayUploadRequirementType,
  evaluateTripDocumentRequirements,
} from "../src/transport/workflows/trip-document-requirement-evaluation";
import { suggestTripOrderByNearestNeighbour } from "../src/transport/trips/trip-order-suggest";
import {
  assertUatOrStop,
  DEMO_PREFIX,
  demoInvoiceNo,
  demoKey,
  demoStorageKey,
  redactId,
  tenantSlug,
} from "./uat-demo-phases-1-7-lib";

type Counts = { created: number; reused: number; updated: number };

const counts: Counts = { created: 0, reused: 0, updated: 0 };

function bump(kind: keyof Counts) {
  counts[kind] += 1;
}

/** Singapore sample points — distinct enough for NN reorder demos. */
const SG = {
  tuas: {
    label: "Tuas Port Gate",
    address: "Tuas Port Boulevard",
    postal: "637551",
    lat: 1.2685,
    lng: 103.6512,
  },
  pasirPanjang: {
    label: "PSA Pasir Panjang",
    address: "Pasir Panjang Terminal Building",
    postal: "118507",
    lat: 1.2741,
    lng: 103.7912,
  },
  clementi: {
    label: "Clementi Logistics Hub",
    address: "20 Toh Guan Rd",
    postal: "608838",
    lat: 1.3162,
    lng: 103.7649,
  },
  geylang: {
    label: "Geylang Warehouse",
    address: "100 Aljunied Rd",
    postal: "389837",
    lat: 1.3201,
    lng: 103.8918,
  },
  tampines: {
    label: "Tampines Industrial",
    address: "2 Tampines Industrial Ave 5",
    postal: "528830",
    lat: 1.3526,
    lng: 103.9447,
  },
  changi: {
    label: "Changi Airfreight Centre",
    address: "Changi Airfreight Centre",
    postal: "819480",
    lat: 1.375,
    lng: 103.995,
  },
  woodlands: {
    label: "Woodlands Checkpoint Area",
    address: "21 Woodlands Crossing",
    postal: "738203",
    lat: 1.436,
    lng: 103.786,
  },
  amk: {
    label: "Ang Mo Kio Tech Park",
    address: "2 Ang Mo Kio St 64",
    postal: "569084",
    lat: 1.3691,
    lng: 103.8454,
  },
  jurongEast: {
    label: "Jurong East Depot",
    address: "1 Venture Ave",
    postal: "608521",
    lat: 1.3332,
    lng: 103.7422,
  },
  bukitMerah: {
    label: "Bukit Merah Central",
    address: "10 Bukit Merah Central",
    postal: "159836",
    lat: 1.283,
    lng: 103.823,
  },
} as const;

type Loc = (typeof SG)[keyof typeof SG];

async function upsertJob(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    customerCompanyId: string;
    externalRef: string;
    internalRef: string;
    jobTypes: JobType[];
    collectionType?: CollectionType | null;
    status?: JobStatus;
    pickupDate: Date;
    pickup: Loc;
    delivery: Loc;
    notes?: string;
    description?: string;
  },
) {
  const compatibilityJobType =
    input.jobTypes.length === 1 ? input.jobTypes[0]! : null;
  const existing = await prisma.job.findFirst({
    where: { tenantId: input.tenantId, externalRef: input.externalRef },
    select: { id: true },
  });

  const data = {
    customerCompanyId: input.customerCompanyId,
    internalRef: input.internalRef,
    externalRef: input.externalRef,
    jobType: compatibilityJobType,
    collectionType:
      input.collectionType ??
      (input.jobTypes.includes(JobType.COLLECTION) &&
      input.jobTypes.length === 1
        ? CollectionType.LOADED
        : null),
    status: input.status ?? JobStatus.ONGOING,
    pickupDate: input.pickupDate,
    pickupAddress1: input.pickup.address,
    pickupPostal: input.pickup.postal,
    pickupContactName: "UAT Demo PIC",
    pickupContactPhone: "+65 6000 0001",
    deliveryAddress1: input.delivery.address,
    deliveryPostal: input.delivery.postal,
    receiverName: "UAT Demo Receiver",
    receiverPhone: "+65 6000 0002",
    notes: input.notes ?? `${DEMO_PREFIX} seeded job`,
    description: input.description ?? `${DEMO_PREFIX} demo`,
    invoiceReadyAt: new Date(),
  };

  let jobId: string;
  if (existing) {
    await prisma.job.update({ where: { id: existing.id }, data });
    jobId = existing.id;
    bump("reused");
    bump("updated");
  } else {
    const created = await prisma.job.create({
      data: {
        tenantId: input.tenantId,
        ...data,
      },
      select: { id: true },
    });
    jobId = created.id;
    bump("created");
  }

  // Canonical multi-type membership
  await prisma.jobTypeAssignment.deleteMany({
    where: { tenantId: input.tenantId, jobId },
  });
  await prisma.jobTypeAssignment.createMany({
    data: input.jobTypes.map((jobType) => ({
      tenantId: input.tenantId,
      jobId,
      jobType,
    })),
  });

  return jobId;
}

async function upsertTrip(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    jobId: string;
    titleKey: string;
    tripType: JobType;
    status: TripStatus;
    tripSequence: number;
    jobSequence: number;
    routeVersion?: number;
    dispatchSequence?: number | null;
    dispatchVersion?: number;
    plannedStartAt: Date;
    origin: Loc;
    destination: Loc;
    assignedDriverUserId?: string | null;
    driverId?: string | null;
    vehicleId?: string | null;
    startedAt?: Date | null;
    publishedAt?: Date | null;
    closedAt?: Date | null;
    displayTitle?: string;
    notes?: string;
  },
) {
  const existing = await prisma.trip.findFirst({
    where: { tenantId: input.tenantId, title: input.titleKey },
    select: { id: true, routeVersion: true, dispatchVersion: true },
  });

  const base = {
    jobId: input.jobId,
    status: input.status,
    tripType: input.tripType,
    tripSequence: input.tripSequence,
    jobSequence: input.jobSequence,
    routeVersion: input.routeVersion ?? existing?.routeVersion ?? 1,
    dispatchSequence: input.dispatchSequence ?? null,
    dispatchVersion: input.dispatchVersion ?? existing?.dispatchVersion ?? 1,
    plannedStartAt: input.plannedStartAt,
    title: input.titleKey,
    displayTitle: input.displayTitle ?? input.titleKey.split("/").pop()!,
    notes: input.notes ?? DEMO_PREFIX,
    assignedDriverUserId: input.assignedDriverUserId ?? null,
    driverId: input.driverId ?? null,
    vehicleId: input.vehicleId ?? null,
    assignedAt: input.assignedDriverUserId ? new Date() : null,
    publishedAt:
      input.publishedAt ??
      (input.status === TripStatus.DRAFT ? null : new Date()),
    startedAt:
      input.startedAt ??
      (input.status === TripStatus.ONGOING ||
      input.status === TripStatus.COMPLETED
        ? new Date()
        : null),
    closedAt:
      input.closedAt ??
      (input.status === TripStatus.COMPLETED ||
      input.status === TripStatus.CANCELLED
        ? new Date()
        : null),
    originLabel: input.origin.label,
    originAddressLine1: input.origin.address,
    originPostalCode: input.origin.postal,
    originCountry: "SG",
    originLat: input.origin.lat,
    originLng: input.origin.lng,
    destinationLabel: input.destination.label,
    destinationAddressLine1: input.destination.address,
    destinationPostalCode: input.destination.postal,
    destinationCountry: "SG",
    destinationLat: input.destination.lat,
    destinationLng: input.destination.lng,
  };

  if (existing) {
    await prisma.trip.update({ where: { id: existing.id }, data: base });
    bump("reused");
    bump("updated");
    return existing.id;
  }
  const created = await prisma.trip.create({
    data: { tenantId: input.tenantId, ...base },
    select: { id: true },
  });
  bump("created");
  return created.id;
}

async function upsertPayout(
  prisma: PrismaClient,
  tenantId: string,
  tripId: string,
  amountCents: number,
  label: string,
) {
  const existing = await prisma.tripPayoutLine.findFirst({
    where: { tenantId, tripId, label },
    select: { id: true },
  });
  const data = {
    sourceType: JobChargeSourceType.MANUAL,
    label,
    code: `${DEMO_PREFIX}-PAY`,
    quantity: 1,
    amountCents,
    totalCents: amountCents,
    isManual: true,
    isSelectableForTripEarning: true,
    sortOrder: 0,
  };
  if (existing) {
    await prisma.tripPayoutLine.update({ where: { id: existing.id }, data });
    bump("reused");
  } else {
    await prisma.tripPayoutLine.create({
      data: { tenantId, tripId, ...data },
    });
    bump("created");
  }
  await prisma.trip.update({
    where: { id: tripId },
    data: { driverEarningCents: amountCents },
  });
}

async function upsertCharge(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
  code: string,
  amountCents: number,
  label: string,
) {
  const existing = await prisma.jobCharge.findFirst({
    where: { tenantId, jobId, code },
    select: { id: true },
  });
  const data = {
    sourceType: JobChargeSourceType.MANUAL,
    code,
    label,
    qty: 1,
    unitPriceCents: amountCents,
    amountCents,
    currency: "SGD",
    taxable: false,
    taxCode: "ZR",
    taxRateBasisPoints: 0,
    sortOrder: 0,
  };
  if (existing) {
    await prisma.jobCharge.update({ where: { id: existing.id }, data });
    bump("reused");
    return existing.id;
  }
  const created = await prisma.jobCharge.create({
    data: { tenantId, jobId, ...data },
    select: { id: true },
  });
  bump("created");
  return created.id;
}

async function upsertInvoiceWithChargeLine(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    customerName: string;
    customerCompanyId: string;
    invoiceNo: string;
    status: InvoiceStatus;
    sourceJobId: string;
    jobChargeId: string;
    amountCents: number;
    description: string;
  },
) {
  const existing = await prisma.invoice.findFirst({
    where: { tenantId: input.tenantId, invoiceNo: input.invoiceNo },
    select: { id: true },
  });

  const amount = input.amountCents;
  const invoiceData = {
    customerName: input.customerName,
    customerCompanyId: input.customerCompanyId,
    sourceJobId: input.sourceJobId,
    currency: "SGD",
    status: input.status,
    subtotalCents: amount,
    taxCents: 0,
    totalCents: amount,
    issuedAt:
      input.status === InvoiceStatus.ISSUED || input.status === InvoiceStatus.PAID
        ? new Date()
        : null,
    paidAt: input.status === InvoiceStatus.PAID ? new Date() : null,
    lockedAt:
      input.status === InvoiceStatus.ISSUED || input.status === InvoiceStatus.PAID
        ? new Date()
        : null,
    notes: DEMO_PREFIX,
  };

  let invoiceId: string;
  if (existing) {
    await prisma.invoice.update({
      where: { id: existing.id },
      data: invoiceData,
    });
    invoiceId = existing.id;
    bump("reused");
  } else {
    const created = await prisma.invoice.create({
      data: {
        tenantId: input.tenantId,
        invoiceNo: input.invoiceNo,
        ...invoiceData,
      },
      select: { id: true },
    });
    invoiceId = created.id;
    bump("created");
  }

  // Replace line items for this invoice (idempotent, charge-backed only)
  await prisma.invoiceLineItem.deleteMany({
    where: { tenantId: input.tenantId, invoiceId },
  });
  await prisma.invoiceLineItem.create({
    data: {
      tenantId: input.tenantId,
      invoiceId,
      description: input.description,
      qty: 1,
      unitPriceCents: amount,
      amountCents: amount,
      taxCode: "ZR",
      taxRate: 0,
      taxCents: 0,
      sourceType: "JOB",
      jobChargeId: input.jobChargeId,
    },
  });
  bump("created");

  await prisma.invoiceChargeReservation.deleteMany({
    where: { tenantId: input.tenantId, jobChargeId: input.jobChargeId },
  });
  if (
    input.status === InvoiceStatus.DRAFT ||
    input.status === InvoiceStatus.GENERATED ||
    input.status === InvoiceStatus.ISSUED ||
    input.status === InvoiceStatus.PAID
  ) {
    await prisma.invoiceChargeReservation.create({
      data: {
        tenantId: input.tenantId,
        invoiceId,
        jobChargeId: input.jobChargeId,
      },
    });
    bump("created");
  }

  return invoiceId;
}

async function replaceRequirements(
  prisma: PrismaClient,
  tenantId: string,
  tripId: string,
  rows: Array<{
    type: TripDocumentType;
    label: string;
    isRequired: boolean;
    requiresSignature: boolean;
    minCount: number;
    sortOrder: number;
    responsibleUploader: TripDocumentResponsibleUploader;
    requirementStage: TripDocumentRequirementStage;
  }>,
) {
  await prisma.tripDocumentRequirement.deleteMany({ where: { tenantId, tripId } });
  for (const row of rows) {
    await prisma.tripDocumentRequirement.create({
      data: { tenantId, tripId, ...row },
    });
    bump("created");
  }
}

async function replaceDocuments(
  prisma: PrismaClient,
  tenantId: string,
  tripId: string,
  docs: Array<{
    type: TripDocumentType;
    originalName: string;
    isSigned?: boolean;
    signedAt?: Date | null;
    storageSuffix: string;
  }>,
) {
  await prisma.tripDocument.deleteMany({ where: { tenantId, tripId } });
  for (const doc of docs) {
    await prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        type: doc.type,
        storageKey: demoStorageKey("docs", doc.storageSuffix),
        originalName: doc.originalName,
        mimeType: "image/png",
        sizeBytes: 68,
        isActive: true,
        isSigned: doc.isSigned ?? false,
        signedAt: doc.signedAt ?? null,
        requiresSignature: Boolean(doc.isSigned),
      },
    });
    bump("created");
  }
}

async function upsertExpense(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    jobId: string;
    tripId: string;
    submittedByUserId: string;
    submittedByDriverId: string | null;
    key: string;
    category: TripExpenseCategory;
    paymentMethod: TripExpensePaymentMethod;
    amountCents: number;
    reviewStatus: TripExpenseReviewStatus;
    reimbursementStatus: TripExpenseReimbursementStatus;
    reviewReason?: string | null;
    reviewedByUserId?: string | null;
    withReceipt: boolean;
  },
) {
  const remarks = `${input.key}`;
  const existing = await prisma.tripExpense.findFirst({
    where: { tenantId: input.tenantId, tripId: input.tripId, remarks },
    select: { id: true },
  });

  const data = {
    jobId: input.jobId,
    tripId: input.tripId,
    submittedByUserId: input.submittedByUserId,
    submittedByDriverId: input.submittedByDriverId,
    category: input.category,
    paymentMethod: input.paymentMethod,
    amountCents: input.amountCents,
    currency: "SGD",
    transactionDate: new Date(),
    remarks,
    reviewStatus: input.reviewStatus,
    reimbursementStatus: input.reimbursementStatus,
    reviewReason: input.reviewReason ?? null,
    reviewedByUserId: input.reviewedByUserId ?? null,
    reviewedAt: input.reviewedByUserId ? new Date() : null,
  };

  let expenseId: string;
  if (existing) {
    await prisma.tripExpense.update({ where: { id: existing.id }, data });
    expenseId = existing.id;
    bump("reused");
  } else {
    const created = await prisma.tripExpense.create({
      data: { tenantId: input.tenantId, ...data },
      select: { id: true },
    });
    expenseId = created.id;
    bump("created");
    await prisma.tripExpenseEvent.create({
      data: {
        tenantId: input.tenantId,
        expenseId,
        actorUserId: input.submittedByUserId,
        action: TripExpenseEventAction.SUBMITTED,
        newStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      },
    });
  }

  await prisma.tripExpenseAttachment.deleteMany({
    where: { tenantId: input.tenantId, expenseId },
  });
  if (input.withReceipt) {
    await prisma.tripExpenseAttachment.create({
      data: {
        tenantId: input.tenantId,
        expenseId,
        storageKey: demoStorageKey("receipts", `${input.key}.png`),
        originalName: "synthetic-receipt.png",
        mimeType: "image/png",
        sizeBytes: 68,
        uploadedByUserId: input.submittedByUserId,
        isActive: true,
      },
    });
    bump("created");
  }

  return expenseId;
}

async function main() {
  assertUatOrStop();
  const prisma = new PrismaClient();
  const incomplete: string[] = [];

  try {
    const slug = tenantSlug();
    const tenant = await prisma.tenant.findFirst({
      where: { slug, status: "ACTIVE" },
      select: { id: true, slug: true, name: true, timezone: true },
    });
    if (!tenant) throw new Error(`STOP: tenant ${slug} not found`);
    const timezone = tenant.timezone || "Asia/Singapore";
    const operatingDate = todayOperatingDate(timezone);
    const midday = new Date(`${operatingDate}T04:00:00.000Z`); // ~12:00 SGT

    const customer = await prisma.customer_companies.findFirst({
      where: {
        tenantId: tenant.id,
        isActive: true,
        name: { contains: "Alpha" },
      },
      select: { id: true, name: true },
    });
    if (!customer) throw new Error("STOP: no suitable customer");

    const drivers = await prisma.drivers.findMany({
      where: { tenantId: tenant.id, userId: { not: null } },
      select: { id: true, userId: true, name: true },
      orderBy: { name: "asc" },
      take: 3,
    });
    if (drivers.length < 3) throw new Error("STOP: need 3 drivers");
    const [driverA, driverB, driverC] = drivers;

    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId: tenant.id, status: "ACTIVE" },
      select: { id: true, plateNo: true },
      orderBy: { createdAt: "asc" },
      take: 3,
    });
    if (vehicles.length < 3) throw new Error("STOP: need 3 vehicles");
    const [vehA, vehB, vehC] = vehicles;

    const opsUser = await prisma.tenantMembership.findFirst({
      where: {
        tenantId: tenant.id,
        status: "Active",
        role: {
          in: [Role.TRANSPORT_STAFF, Role.ADMIN, Role.OPS, Role.FINANCE],
        },
      },
      select: { userId: true },
    });
    const opsUserId = opsUser?.userId ?? driverA.userId!;

    // ---------- Finance jobs ----------
    const finJobs: Record<
      string,
      { jobId: string; tripId: string; expected: string }
    > = {};

    // 1) Negative payout: 150 vs 100 ISSUED
    {
      const key = "FIN/NEG-PAYOUT";
      const jobId = await upsertJob(prisma, {
        tenantId: tenant.id,
        customerCompanyId: customer.id,
        externalRef: demoKey(key),
        internalRef: `${DEMO_PREFIX}-FIN-01`,
        jobTypes: [JobType.LCL],
        status: JobStatus.COMPLETED,
        pickupDate: midday,
        pickup: SG.clementi,
        delivery: SG.geylang,
        description: "Finance NEGATIVE via driver payout > issued revenue",
      });
      const tripId = await upsertTrip(prisma, {
        tenantId: tenant.id,
        jobId,
        titleKey: demoKey(`${key}/TRIP`),
        tripType: JobType.LCL,
        status: TripStatus.COMPLETED,
        tripSequence: 1,
        jobSequence: 1,
        plannedStartAt: new Date(midday.getTime() - 86400000),
        origin: SG.clementi,
        destination: SG.geylang,
        assignedDriverUserId: driverA.userId!,
        driverId: driverA.id,
        vehicleId: vehA.id,
      });
      await upsertPayout(prisma, tenant.id, tripId, 15000, `${DEMO_PREFIX} payout 150`);
      const chargeId = await upsertCharge(
        prisma,
        tenant.id,
        jobId,
        `${DEMO_PREFIX}-CHG-NEG-PAY`,
        10000,
        "Trucking",
      );
      await upsertInvoiceWithChargeLine(prisma, {
        tenantId: tenant.id,
        customerName: customer.name,
        customerCompanyId: customer.id,
        invoiceNo: demoInvoiceNo("INV-NEG-PAY"),
        status: InvoiceStatus.ISSUED,
        sourceJobId: jobId,
        jobChargeId: chargeId,
        amountCents: 10000,
        description: "Attributable ISSUED line SGD 100",
      });
      finJobs.NEG_PAYOUT = { jobId, tripId, expected: "NEGATIVE" };
    }

    // 2) Negative expense: 80 + 50 APPROVED vs 100 ISSUED
    {
      const key = "FIN/NEG-EXPENSE";
      const jobId = await upsertJob(prisma, {
        tenantId: tenant.id,
        customerCompanyId: customer.id,
        externalRef: demoKey(key),
        internalRef: `${DEMO_PREFIX}-FIN-02`,
        jobTypes: [JobType.COLLECTION],
        collectionType: CollectionType.LOADED,
        status: JobStatus.COMPLETED,
        pickupDate: midday,
        pickup: SG.bukitMerah,
        delivery: SG.pasirPanjang,
        description: "Finance NEGATIVE via approved expense",
      });
      const tripId = await upsertTrip(prisma, {
        tenantId: tenant.id,
        jobId,
        titleKey: demoKey(`${key}/TRIP`),
        tripType: JobType.COLLECTION,
        status: TripStatus.COMPLETED,
        tripSequence: 1,
        jobSequence: 1,
        plannedStartAt: new Date(midday.getTime() - 86400000),
        origin: SG.bukitMerah,
        destination: SG.pasirPanjang,
        assignedDriverUserId: driverB.userId!,
        driverId: driverB.id,
        vehicleId: vehB.id,
      });
      await upsertPayout(prisma, tenant.id, tripId, 8000, `${DEMO_PREFIX} payout 80`);
      await upsertExpense(prisma, {
        tenantId: tenant.id,
        jobId,
        tripId,
        submittedByUserId: driverB.userId!,
        submittedByDriverId: driverB.id,
        key: demoKey(`${key}/EXP-APPROVED-DRIVER-PAID`),
        category: TripExpenseCategory.PARKING,
        paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
        amountCents: 5000,
        reviewStatus: TripExpenseReviewStatus.APPROVED,
        reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
        reviewedByUserId: opsUserId,
        withReceipt: true,
      });
      const chargeId = await upsertCharge(
        prisma,
        tenant.id,
        jobId,
        `${DEMO_PREFIX}-CHG-NEG-EXP`,
        10000,
        "Collection fee",
      );
      await upsertInvoiceWithChargeLine(prisma, {
        tenantId: tenant.id,
        customerName: customer.name,
        customerCompanyId: customer.id,
        invoiceNo: demoInvoiceNo("INV-NEG-EXP"),
        status: InvoiceStatus.ISSUED,
        sourceJobId: jobId,
        jobChargeId: chargeId,
        amountCents: 10000,
        description: "Attributable ISSUED line SGD 100",
      });
      finJobs.NEG_EXPENSE = { jobId, tripId, expected: "NEGATIVE" };
    }

    // 3) Profitable: 80 + 20 APPROVED vs 150 PAID
    {
      const key = "FIN/PROFITABLE";
      const jobId = await upsertJob(prisma, {
        tenantId: tenant.id,
        customerCompanyId: customer.id,
        externalRef: demoKey(key),
        internalRef: `${DEMO_PREFIX}-FIN-03`,
        jobTypes: [JobType.EXPORT],
        status: JobStatus.COMPLETED,
        pickupDate: midday,
        pickup: SG.jurongEast,
        delivery: SG.tuas,
        description: "Finance NON_NEGATIVE profitable",
      });
      const tripId = await upsertTrip(prisma, {
        tenantId: tenant.id,
        jobId,
        titleKey: demoKey(`${key}/TRIP`),
        tripType: JobType.EXPORT,
        status: TripStatus.COMPLETED,
        tripSequence: 1,
        jobSequence: 1,
        plannedStartAt: new Date(midday.getTime() - 86400000),
        origin: SG.jurongEast,
        destination: SG.tuas,
        assignedDriverUserId: driverC.userId!,
        driverId: driverC.id,
        vehicleId: vehC.id,
      });
      await upsertPayout(prisma, tenant.id, tripId, 8000, `${DEMO_PREFIX} payout 80`);
      await upsertExpense(prisma, {
        tenantId: tenant.id,
        jobId,
        tripId,
        submittedByUserId: driverC.userId!,
        submittedByDriverId: driverC.id,
        key: demoKey(`${key}/EXP-APPROVED-COMPANY`),
        category: TripExpenseCategory.TOLL,
        paymentMethod: TripExpensePaymentMethod.COMPANY_EPAYMENT,
        amountCents: 2000,
        reviewStatus: TripExpenseReviewStatus.APPROVED,
        reimbursementStatus: TripExpenseReimbursementStatus.NOT_REQUIRED,
        reviewedByUserId: opsUserId,
        withReceipt: true,
      });
      const chargeId = await upsertCharge(
        prisma,
        tenant.id,
        jobId,
        `${DEMO_PREFIX}-CHG-PROFIT`,
        15000,
        "Export trucking",
      );
      await upsertInvoiceWithChargeLine(prisma, {
        tenantId: tenant.id,
        customerName: customer.name,
        customerCompanyId: customer.id,
        invoiceNo: demoInvoiceNo("INV-PROFIT"),
        status: InvoiceStatus.PAID,
        sourceJobId: jobId,
        jobChargeId: chargeId,
        amountCents: 15000,
        description: "Attributable PAID line SGD 150",
      });
      finJobs.PROFITABLE = { jobId, tripId, expected: "NON_NEGATIVE" };
    }

    // 4) Not invoiced: payout 70, DRAFT only
    {
      const key = "FIN/NOT-INVOICED";
      const jobId = await upsertJob(prisma, {
        tenantId: tenant.id,
        customerCompanyId: customer.id,
        externalRef: demoKey(key),
        internalRef: `${DEMO_PREFIX}-FIN-04`,
        jobTypes: [JobType.IMPORT],
        status: JobStatus.READY_FOR_INVOICE,
        pickupDate: midday,
        pickup: SG.pasirPanjang,
        delivery: SG.amk,
        description: "Finance NOT_INVOICED (draft/generated only)",
      });
      const tripId = await upsertTrip(prisma, {
        tenantId: tenant.id,
        jobId,
        titleKey: demoKey(`${key}/TRIP`),
        tripType: JobType.IMPORT,
        status: TripStatus.COMPLETED,
        tripSequence: 1,
        jobSequence: 1,
        plannedStartAt: new Date(midday.getTime() - 86400000),
        origin: SG.pasirPanjang,
        destination: SG.amk,
        assignedDriverUserId: driverA.userId!,
        driverId: driverA.id,
        vehicleId: vehA.id,
      });
      await upsertPayout(prisma, tenant.id, tripId, 7000, `${DEMO_PREFIX} payout 70`);
      const chargeId = await upsertCharge(
        prisma,
        tenant.id,
        jobId,
        `${DEMO_PREFIX}-CHG-DRAFT`,
        9000,
        "Import trucking",
      );
      await upsertInvoiceWithChargeLine(prisma, {
        tenantId: tenant.id,
        customerName: customer.name,
        customerCompanyId: customer.id,
        invoiceNo: demoInvoiceNo("INV-DRAFT"),
        status: InvoiceStatus.DRAFT,
        sourceJobId: jobId,
        jobChargeId: chargeId,
        amountCents: 9000,
        description: "DRAFT line — must not count as revenue",
      });
      // Also a GENERATED invoice without charge attribution for visibility
      const genNo = demoInvoiceNo("INV-GENERATED");
      const genExisting = await prisma.invoice.findFirst({
        where: { tenantId: tenant.id, invoiceNo: genNo },
        select: { id: true },
      });
      if (genExisting) {
        await prisma.invoice.update({
          where: { id: genExisting.id },
          data: {
            status: InvoiceStatus.GENERATED,
            sourceJobId: jobId,
            subtotalCents: 9000,
            taxCents: 0,
            totalCents: 9000,
            notes: DEMO_PREFIX,
          },
        });
        bump("reused");
      } else {
        await prisma.invoice.create({
          data: {
            tenantId: tenant.id,
            invoiceNo: genNo,
            customerName: customer.name,
            customerCompanyId: customer.id,
            sourceJobId: jobId,
            currency: "SGD",
            status: InvoiceStatus.GENERATED,
            subtotalCents: 9000,
            taxCents: 0,
            totalCents: 9000,
            notes: DEMO_PREFIX,
          },
        });
        bump("created");
      }
      finJobs.NOT_INVOICED = { jobId, tripId, expected: "NOT_INVOICED" };
    }

    // 5) Pending expense excluded: 80 + SUBMITTED 100 vs ISSUED 90 → NON_NEGATIVE
    {
      const key = "FIN/PENDING-EXP";
      const jobId = await upsertJob(prisma, {
        tenantId: tenant.id,
        customerCompanyId: customer.id,
        externalRef: demoKey(key),
        internalRef: `${DEMO_PREFIX}-FIN-05`,
        jobTypes: [JobType.LCL],
        status: JobStatus.COMPLETED,
        pickupDate: midday,
        pickup: SG.tampines,
        delivery: SG.woodlands,
        description: "Pending/SUBMITTED expense excluded from cost",
      });
      const tripId = await upsertTrip(prisma, {
        tenantId: tenant.id,
        jobId,
        titleKey: demoKey(`${key}/TRIP`),
        tripType: JobType.LCL,
        status: TripStatus.COMPLETED,
        tripSequence: 1,
        jobSequence: 1,
        plannedStartAt: new Date(midday.getTime() - 86400000),
        origin: SG.tampines,
        destination: SG.woodlands,
        assignedDriverUserId: driverB.userId!,
        driverId: driverB.id,
        vehicleId: vehB.id,
      });
      await upsertPayout(prisma, tenant.id, tripId, 8000, `${DEMO_PREFIX} payout 80`);
      await upsertExpense(prisma, {
        tenantId: tenant.id,
        jobId,
        tripId,
        submittedByUserId: driverB.userId!,
        submittedByDriverId: driverB.id,
        key: demoKey(`${key}/EXP-SUBMITTED`),
        category: TripExpenseCategory.FUEL,
        paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
        amountCents: 10000,
        reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
        reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
        withReceipt: true,
      });
      const chargeId = await upsertCharge(
        prisma,
        tenant.id,
        jobId,
        `${DEMO_PREFIX}-CHG-PEND`,
        9000,
        "LCL trucking",
      );
      await upsertInvoiceWithChargeLine(prisma, {
        tenantId: tenant.id,
        customerName: customer.name,
        customerCompanyId: customer.id,
        invoiceNo: demoInvoiceNo("INV-PEND"),
        status: InvoiceStatus.ISSUED,
        sourceJobId: jobId,
        jobChargeId: chargeId,
        amountCents: 9000,
        description: "Attributable ISSUED line SGD 90",
      });
      finJobs.PENDING_EXP = { jobId, tripId, expected: "NON_NEGATIVE" };
    }

    // Extra expense showcase states on FIN/PROFITABLE trip (non-APPROVED only)
    await upsertExpense(prisma, {
      tenantId: tenant.id,
      jobId: finJobs.PROFITABLE.jobId,
      tripId: finJobs.PROFITABLE.tripId,
      submittedByUserId: driverC.userId!,
      submittedByDriverId: driverC.id,
      key: demoKey("EXP/NEEDS-CLARIFICATION"),
      category: TripExpenseCategory.MEAL,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      amountCents: 1200,
      reviewStatus: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
      reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      reviewReason: "Please re-upload a clearer synthetic receipt",
      reviewedByUserId: opsUserId,
      withReceipt: true,
    });
    await upsertExpense(prisma, {
      tenantId: tenant.id,
      jobId: finJobs.PROFITABLE.jobId,
      tripId: finJobs.PROFITABLE.tripId,
      submittedByUserId: driverC.userId!,
      submittedByDriverId: driverC.id,
      key: demoKey("EXP/REJECTED"),
      category: TripExpenseCategory.MISCELLANEOUS,
      paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
      amountCents: 999,
      reviewStatus: TripExpenseReviewStatus.REJECTED,
      reimbursementStatus: TripExpenseReimbursementStatus.NOT_REQUIRED,
      reviewReason: "Out of policy (synthetic demo rejection)",
      reviewedByUserId: opsUserId,
      withReceipt: true,
    });

    // ---------- Dispatch today (5 jobs, 8+ active) ----------
    const dispatchTripIds: Record<string, string> = {};

    // Job 1: IMPORT + COLLECTION (multi) — Driver A trips 1–2 (inefficient order)
    const multiImpColJobId = await upsertJob(prisma, {
      tenantId: tenant.id,
      customerCompanyId: customer.id,
      externalRef: demoKey("DISPATCH/MULTI-IMP-COL"),
      internalRef: `${DEMO_PREFIX}-DSP-01-MULTI`,
      jobTypes: [JobType.IMPORT, JobType.COLLECTION],
      status: JobStatus.ONGOING,
      pickupDate: midday,
      pickup: SG.changi,
      delivery: SG.tuas,
      description: "Multi-type IMPORT+COLLECTION for route planning",
    });
    // Inefficient: east then west
    dispatchTripIds.DA1 = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: multiImpColJobId,
      titleKey: demoKey("DISPATCH/DA-1-IMPORT"),
      tripType: JobType.IMPORT,
      status: TripStatus.DRAFT,
      tripSequence: 1,
      jobSequence: 1,
      dispatchSequence: 1,
      dispatchVersion: 1,
      plannedStartAt: midday,
      origin: SG.changi,
      destination: SG.tampines,
      assignedDriverUserId: driverA.userId!,
      driverId: driverA.id,
      vehicleId: vehA.id,
      displayTitle: "A1 Changi→Tampines (IMPORT)",
      notes: "DOC: awaiting Delivery DO",
    });
    dispatchTripIds.DA2 = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: multiImpColJobId,
      titleKey: demoKey("DISPATCH/DA-2-COLLECTION"),
      tripType: JobType.COLLECTION,
      status: TripStatus.DRAFT,
      tripSequence: 2,
      jobSequence: 2,
      dispatchSequence: 2,
      dispatchVersion: 1,
      plannedStartAt: midday,
      origin: SG.tuas,
      destination: SG.jurongEast,
      assignedDriverUserId: driverA.userId!,
      driverId: driverA.id,
      vehicleId: vehA.id,
      displayTitle: "A2 Tuas→Jurong (COLLECTION)",
      notes: "DOC: awaiting Operations PERMIT",
    });

    // Job 2: EXPORT + COLLECTION — Driver B (ONGOING locked + one more)
    const multiExpColJobId = await upsertJob(prisma, {
      tenantId: tenant.id,
      customerCompanyId: customer.id,
      externalRef: demoKey("DISPATCH/MULTI-EXP-COL"),
      internalRef: `${DEMO_PREFIX}-DSP-02-MULTI`,
      jobTypes: [JobType.EXPORT, JobType.COLLECTION],
      status: JobStatus.ONGOING,
      pickupDate: midday,
      pickup: SG.jurongEast,
      delivery: SG.pasirPanjang,
      description: "Multi-type EXPORT+COLLECTION; ONGOING locked position",
    });
    dispatchTripIds.DB1_ONGOING = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: multiExpColJobId,
      titleKey: demoKey("DISPATCH/DB-1-ONGOING-EXPORT"),
      tripType: JobType.EXPORT,
      status: TripStatus.ONGOING,
      tripSequence: 1,
      jobSequence: 1,
      dispatchSequence: 1,
      dispatchVersion: 3,
      plannedStartAt: midday,
      origin: SG.pasirPanjang,
      destination: SG.clementi,
      assignedDriverUserId: driverB.userId!,
      driverId: driverB.id,
      vehicleId: vehB.id,
      startedAt: new Date(),
      displayTitle: "B1 ONGOING locked @ pos 1",
      notes: "DOC: POD minCount 2 partial",
    });
    dispatchTripIds.DB2 = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: multiExpColJobId,
      titleKey: demoKey("DISPATCH/DB-2-COLLECTION"),
      tripType: JobType.COLLECTION,
      status: TripStatus.PUBLISHED,
      tripSequence: 2,
      jobSequence: 2,
      dispatchSequence: 2,
      dispatchVersion: 3,
      plannedStartAt: midday,
      origin: SG.woodlands,
      destination: SG.amk,
      assignedDriverUserId: driverB.userId!,
      driverId: driverB.id,
      vehicleId: vehB.id,
      displayTitle: "B2 Woodlands→AMK (COLLECTION)",
    });

    // Job 3: LCL — Driver A trip 3 + Driver C
    const lclJobId = await upsertJob(prisma, {
      tenantId: tenant.id,
      customerCompanyId: customer.id,
      externalRef: demoKey("DISPATCH/LCL"),
      internalRef: `${DEMO_PREFIX}-DSP-03-LCL`,
      jobTypes: [JobType.LCL],
      status: JobStatus.ONGOING,
      pickupDate: midday,
      pickup: SG.geylang,
      delivery: SG.tampines,
      description: "Single-type LCL; Driver A #3 + Driver C ready docs",
    });
    dispatchTripIds.DA3 = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: lclJobId,
      titleKey: demoKey("DISPATCH/DA-3-LCL"),
      tripType: JobType.LCL,
      status: TripStatus.PUBLISHED,
      tripSequence: 1,
      jobSequence: 1,
      dispatchSequence: 3,
      dispatchVersion: 1,
      plannedStartAt: midday,
      origin: SG.tampines,
      destination: SG.changi,
      assignedDriverUserId: driverA.userId!,
      driverId: driverA.id,
      vehicleId: vehA.id,
      displayTitle: "A3 Tampines→Changi (LCL)",
    });
    dispatchTripIds.DC1 = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: lclJobId,
      titleKey: demoKey("DISPATCH/DC-1-LCL"),
      tripType: JobType.LCL,
      status: TripStatus.PUBLISHED,
      tripSequence: 2,
      jobSequence: 2,
      dispatchSequence: 1,
      dispatchVersion: 1,
      plannedStartAt: midday,
      origin: SG.geylang,
      destination: SG.bukitMerah,
      assignedDriverUserId: driverC.userId!,
      driverId: driverC.id,
      vehicleId: vehC.id,
      displayTitle: "C1 READY documents",
      notes: "DOC: READY",
    });

    // Job 4: COLLECTION — 2 unassigned DRAFT
    const colJobId = await upsertJob(prisma, {
      tenantId: tenant.id,
      customerCompanyId: customer.id,
      externalRef: demoKey("DISPATCH/COL"),
      internalRef: `${DEMO_PREFIX}-DSP-04-COL`,
      jobTypes: [JobType.COLLECTION],
      collectionType: CollectionType.EMPTY,
      status: JobStatus.ONGOING,
      pickupDate: midday,
      pickup: SG.amk,
      delivery: SG.woodlands,
      description: "Unassigned DRAFT trips for lane planning",
    });
    dispatchTripIds.UN1 = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: colJobId,
      titleKey: demoKey("DISPATCH/UN-1"),
      tripType: JobType.COLLECTION,
      status: TripStatus.DRAFT,
      tripSequence: 1,
      jobSequence: 1,
      dispatchSequence: null,
      plannedStartAt: midday,
      origin: SG.amk,
      destination: SG.woodlands,
      displayTitle: "Unassigned 1 — unsigned Delivery DO",
      notes: "DOC: unsigned Delivery DO",
    });
    dispatchTripIds.UN2 = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: colJobId,
      titleKey: demoKey("DISPATCH/UN-2"),
      tripType: JobType.COLLECTION,
      status: TripStatus.DRAFT,
      tripSequence: 2,
      jobSequence: 2,
      dispatchSequence: null,
      plannedStartAt: midday,
      origin: SG.clementi,
      destination: SG.tuas,
      displayTitle: "Unassigned 2 — reference-only doc",
      notes: "DOC: reference-only",
    });

    // Job 5: exclusion — COMPLETED + CANCELLED today
    const exclJobId = await upsertJob(prisma, {
      tenantId: tenant.id,
      customerCompanyId: customer.id,
      externalRef: demoKey("DISPATCH/EXCLUSION"),
      internalRef: `${DEMO_PREFIX}-DSP-05-EXCL`,
      jobTypes: [JobType.IMPORT],
      status: JobStatus.ONGOING,
      pickupDate: midday,
      pickup: SG.pasirPanjang,
      delivery: SG.geylang,
      description: "COMPLETED/CANCELLED excluded from active planning",
    });
    dispatchTripIds.DONE = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: exclJobId,
      titleKey: demoKey("DISPATCH/DONE"),
      tripType: JobType.IMPORT,
      status: TripStatus.COMPLETED,
      tripSequence: 1,
      jobSequence: 1,
      dispatchSequence: 9,
      plannedStartAt: midday,
      origin: SG.pasirPanjang,
      destination: SG.geylang,
      assignedDriverUserId: driverA.userId!,
      driverId: driverA.id,
      vehicleId: vehA.id,
      displayTitle: "COMPLETED (excluded)",
    });
    dispatchTripIds.CANCELLED = await upsertTrip(prisma, {
      tenantId: tenant.id,
      jobId: exclJobId,
      titleKey: demoKey("DISPATCH/CANCELLED"),
      tripType: JobType.IMPORT,
      status: TripStatus.CANCELLED,
      tripSequence: 2,
      jobSequence: 2,
      dispatchSequence: 10,
      plannedStartAt: midday,
      origin: SG.bukitMerah,
      destination: SG.amk,
      assignedDriverUserId: driverC.userId!,
      driverId: driverC.id,
      vehicleId: vehC.id,
      displayTitle: "CANCELLED (excluded)",
    });

    // ---------- Document readiness snapshots ----------
    // DA1: awaiting driver Delivery DO
    await replaceRequirements(prisma, tenant.id, dispatchTripIds.DA1, [
      {
        type: TripDocumentType.DELIVERY_DO,
        label: "Delivery DO",
        isRequired: true,
        requiresSignature: true,
        minCount: 1,
        sortOrder: 0,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
      {
        type: TripDocumentType.POD_PHOTO,
        label: "Proof of Delivery Photo",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 1,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
    ]);
    await replaceDocuments(prisma, tenant.id, dispatchTripIds.DA1, []);

    // DA2: awaiting Operations PERMIT at BEFORE_DISPATCH (driver may view, not upload)
    await replaceRequirements(prisma, tenant.id, dispatchTripIds.DA2, [
      {
        type: TripDocumentType.PERMIT,
        label: "Port Permit",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 0,
        responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
        requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
      },
      {
        type: TripDocumentType.POD_PHOTO,
        label: "Proof of Delivery Photo",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 1,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
    ]);
    await replaceDocuments(prisma, tenant.id, dispatchTripIds.DA2, []);

    // DB1 ONGOING: POD minCount 2 with only 1 upload
    await replaceRequirements(prisma, tenant.id, dispatchTripIds.DB1_ONGOING, [
      {
        type: TripDocumentType.POD_PHOTO,
        label: "Proof of Delivery Photo",
        isRequired: true,
        requiresSignature: false,
        minCount: 2,
        sortOrder: 0,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
      {
        type: TripDocumentType.DELIVERY_DO,
        label: "Delivery DO",
        isRequired: true,
        requiresSignature: true,
        minCount: 1,
        sortOrder: 1,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
    ]);
    await replaceDocuments(prisma, tenant.id, dispatchTripIds.DB1_ONGOING, [
      {
        type: TripDocumentType.POD_PHOTO,
        originalName: "pod-1.png",
        storageSuffix: "db1-pod-1.png",
      },
      {
        type: TripDocumentType.DELIVERY_DO,
        originalName: "delivery-do-signed.png",
        isSigned: true,
        signedAt: new Date(),
        storageSuffix: "db1-do-signed.png",
      },
    ]);

    // DC1: READY — all satisfied
    await replaceRequirements(prisma, tenant.id, dispatchTripIds.DC1, [
      {
        type: TripDocumentType.DELIVERY_DO,
        label: "Delivery DO",
        isRequired: true,
        requiresSignature: true,
        minCount: 1,
        sortOrder: 0,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
      {
        type: TripDocumentType.POD_PHOTO,
        label: "Proof of Delivery Photo",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 1,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
    ]);
    await replaceDocuments(prisma, tenant.id, dispatchTripIds.DC1, [
      {
        type: TripDocumentType.DELIVERY_DO,
        originalName: "delivery-do-signed.png",
        isSigned: true,
        signedAt: new Date(),
        storageSuffix: "dc1-do.png",
      },
      {
        type: TripDocumentType.POD_PHOTO,
        originalName: "pod.png",
        storageSuffix: "dc1-pod.png",
      },
    ]);

    // UN1: Delivery DO uploaded unsigned
    await replaceRequirements(prisma, tenant.id, dispatchTripIds.UN1, [
      {
        type: TripDocumentType.DELIVERY_DO,
        label: "Delivery DO",
        isRequired: true,
        requiresSignature: true,
        minCount: 1,
        sortOrder: 0,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
      {
        type: TripDocumentType.POD_PHOTO,
        label: "Proof of Delivery Photo",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 1,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
    ]);
    await replaceDocuments(prisma, tenant.id, dispatchTripIds.UN1, [
      {
        type: TripDocumentType.DELIVERY_DO,
        originalName: "delivery-do-unsigned.png",
        isSigned: false,
        signedAt: null,
        storageSuffix: "un1-do-unsigned.png",
      },
    ]);

    // UN2: reference-only does not block; also ready-ish other reqs
    await replaceRequirements(prisma, tenant.id, dispatchTripIds.UN2, [
      {
        type: TripDocumentType.OTHER,
        label: "Reference packing list",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 0,
        responsibleUploader: TripDocumentResponsibleUploader.EITHER,
        requirementStage: TripDocumentRequirementStage.REFERENCE_ONLY,
      },
      {
        type: TripDocumentType.POD_PHOTO,
        label: "Proof of Delivery Photo",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 1,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
    ]);
    await replaceDocuments(prisma, tenant.id, dispatchTripIds.UN2, [
      {
        type: TripDocumentType.POD_PHOTO,
        originalName: "pod.png",
        storageSuffix: "un2-pod.png",
      },
      // Missing reference OTHER intentionally — must NOT block lifecycle
    ]);

    // ---------- Verification ----------
    const financeService = new JobFinanceSummaryService(prisma as any);
    const financeJobIds = Object.values(finJobs).map((j) => j.jobId);
    const summaries = await financeService.summarizeJobs(tenant.id, financeJobIds);

    const financeReport: Array<Record<string, unknown>> = [];
    let negativeCount = 0;
    for (const [name, meta] of Object.entries(finJobs)) {
      const s = summaries.get(meta.jobId)!;
      const ok = s.financeStatus === meta.expected;
      if (!ok) incomplete.push(`Finance ${name}: got ${s.financeStatus} expected ${meta.expected}`);
      if (s.financeStatus === "NEGATIVE") negativeCount += 1;
      financeReport.push({
        scenario: name,
        jobId: redactId(meta.jobId),
        financeStatus: s.financeStatus,
        expected: meta.expected,
        driverPayoutCents: s.driverPayoutCents,
        miscPayoutCents: s.miscPayoutCents,
        totalCostCents: s.totalCostCents,
        invoiceRevenueCents: s.invoiceRevenueCents,
        differenceCents: s.differenceCents,
        totalJobBillableCents: s.totalJobBillableCents,
        ok,
      });
    }
    if (negativeCount !== 2) {
      incomplete.push(`Expected exactly 2 NEGATIVE finance jobs, got ${negativeCount}`);
    }

    // Active planning set
    const todayTrips = await prisma.trip.findMany({
      where: {
        tenantId: tenant.id,
        title: { startsWith: `${DEMO_PREFIX}/DISPATCH/` },
      },
      select: {
        id: true,
        title: true,
        status: true,
        assignedDriverUserId: true,
        dispatchSequence: true,
        tripSequence: true,
        jobSequence: true,
        routeVersion: true,
        dispatchVersion: true,
        tripType: true,
        jobId: true,
        originLat: true,
        originLng: true,
        destinationLat: true,
        destinationLng: true,
      },
    });
    const activePlanning = todayTrips.filter(
      (t) => !PLANNING_EXCLUDED.includes(t.status as TripStatus),
    );
    const laneA = activePlanning
      .filter((t) => t.assignedDriverUserId === driverA.userId)
      .sort((a, b) => (a.dispatchSequence ?? 999) - (b.dispatchSequence ?? 999));
    const laneB = activePlanning
      .filter((t) => t.assignedDriverUserId === driverB.userId)
      .sort((a, b) => (a.dispatchSequence ?? 999) - (b.dispatchSequence ?? 999));
    const laneC = activePlanning.filter(
      (t) => t.assignedDriverUserId === driverC.userId,
    );
    const unassigned = activePlanning.filter((t) => !t.assignedDriverUserId);

    if (laneA.length !== 3) incomplete.push(`Driver A active trips: ${laneA.length} (want 3)`);
    if (laneB.length !== 2) incomplete.push(`Driver B active trips: ${laneB.length} (want 2)`);
    if (laneC.length !== 1) incomplete.push(`Driver C active trips: ${laneC.length} (want 1)`);
    if (unassigned.length !== 2) incomplete.push(`Unassigned active: ${unassigned.length} (want 2)`);
    if (activePlanning.length < 8) {
      incomplete.push(`Active planning count ${activePlanning.length} < 8`);
    }

    const ongoing = laneB.find((t) => t.status === TripStatus.ONGOING);
    if (!ongoing || ongoing.dispatchSequence !== 1) {
      incomplete.push("ONGOING trip not locked at absolute dispatchSequence=1");
    }
    if (!ongoing || !isDispatchSequenceLocked(ongoing.status)) {
      incomplete.push("ONGOING trip not recognized as sequence-locked");
    }

    // Suggestion advisory: order should change for Driver A; DB sequences unchanged
    const beforeSeq = laneA.map((t) => ({
      id: t.id,
      dispatchSequence: t.dispatchSequence,
    }));
    const nn = suggestTripOrderByNearestNeighbour({
      trips: laneA.map((t) => ({
        id: t.id,
        originLat: t.originLat,
        originLng: t.originLng,
        destinationLat: t.destinationLat,
        destinationLng: t.destinationLng,
        locked: false,
        status: t.status,
      })),
      startLocation: { lat: 1.34, lng: 103.7 },
    });
    const suggested = mergeSuggestedWithLockedAbsolutePositions({
      currentOrderedIds: laneA.map((t) => t.id),
      suggestedUnlockedIds: nn.suggestedTripIdsInOrder,
      lockedIds: new Set(),
    });
    const orderChanged =
      suggested.join(",") !== laneA.map((t) => t.id).join(",");
    if (!orderChanged) {
      incomplete.push("Suggest sequence did not change inefficient Driver A order");
    }
    // Confirm not persisted
    const afterTrips = await prisma.trip.findMany({
      where: { id: { in: laneA.map((t) => t.id) } },
      select: { id: true, dispatchSequence: true },
    });
    for (const b of beforeSeq) {
      const a = afterTrips.find((t) => t.id === b.id);
      if (a?.dispatchSequence !== b.dispatchSequence) {
        incomplete.push("Suggestion unexpectedly persisted dispatchSequence");
      }
    }

    // Document readiness via canonical evaluator
    const docCases: Array<Record<string, unknown>> = [];
    const docTripKeys: Array<[string, string]> = [
      ["READY", dispatchTripIds.DC1],
      ["AWAITING_DELIVERY_DO", dispatchTripIds.DA1],
      ["AWAITING_OPS_PERMIT", dispatchTripIds.DA2],
      ["POD_PARTIAL", dispatchTripIds.DB1_ONGOING],
      ["UNSIGNED_DELIVERY_DO", dispatchTripIds.UN1],
      ["REFERENCE_ONLY", dispatchTripIds.UN2],
    ];
    for (const [label, tripId] of docTripKeys) {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          status: true,
          documents: {
            where: { isActive: true },
            select: {
              type: true,
              isActive: true,
              isSigned: true,
              signedAt: true,
              mimeType: true,
              originalName: true,
            },
          },
          documentRequirements: true,
        },
      });
      const evaluation = evaluateTripDocumentRequirements({
        tripStatus: trip!.status,
        documents: trip!.documents,
        requirements: trip!.documentRequirements,
      });
      const permitReq = trip!.documentRequirements.filter(
        (r) => r.type === TripDocumentType.PERMIT,
      );
      docCases.push({
        label,
        tripId: redactId(tripId),
        readinessStatus: evaluation.readinessStatus,
        missingTypeCodes: evaluation.missingTypeCodes,
        blockingActor: evaluation.blockingActor,
        blockingAction: evaluation.blockingAction,
        driverMayUploadPermit:
          permitReq.length > 0
            ? driverMayUploadRequirementType(permitReq, TripDocumentType.PERMIT)
            : null,
      });
    }

    if (docCases.find((c) => c.label === "READY")?.readinessStatus !== "READY") {
      incomplete.push("READY trip not READY");
    }
    if (
      !(docCases.find((c) => c.label === "AWAITING_DELIVERY_DO")?.missingTypeCodes as string[])?.includes(
        "DELIVERY_DO",
      )
    ) {
      incomplete.push("AWAITING_DELIVERY_DO missing Delivery DO");
    }
    const permitCase = docCases.find((c) => c.label === "AWAITING_OPS_PERMIT");
    if (permitCase?.blockingActor !== "OPERATIONS") {
      incomplete.push("Ops permit not blocking as OPERATIONS");
    }
    if (permitCase?.driverMayUploadPermit !== false) {
      incomplete.push("Driver must not upload OPERATIONS PERMIT");
    }
    const podCase = docCases.find((c) => c.label === "POD_PARTIAL");
    if (
      !(podCase?.missingTypeCodes as string[] | undefined)?.includes("POD_PHOTO") &&
      podCase?.readinessStatus === "READY"
    ) {
      incomplete.push("POD partial should not be fully READY");
    }
    const unsigned = docCases.find((c) => c.label === "UNSIGNED_DELIVERY_DO");
    if (
      !(unsigned?.missingTypeCodes as string[] | undefined)?.includes("DELIVERY_DO")
    ) {
      incomplete.push("Unsigned Delivery DO should remain missing");
    }
    const refOnly = docCases.find((c) => c.label === "REFERENCE_ONLY");
    if ((refOnly?.missingTypeCodes as string[] | undefined)?.includes("OTHER")) {
      incomplete.push("REFERENCE_ONLY OTHER must not appear as lifecycle missing");
    }

    // Multi-type integrity
    const multiJobs = await prisma.job.findMany({
      where: {
        tenantId: tenant.id,
        externalRef: {
          in: [
            demoKey("DISPATCH/MULTI-IMP-COL"),
            demoKey("DISPATCH/MULTI-EXP-COL"),
          ],
        },
      },
      select: {
        id: true,
        externalRef: true,
        jobType: true,
        jobTypeAssignments: { select: { jobType: true } },
        trips: { select: { id: true, tripType: true, title: true } },
      },
    });
    const multiReport = multiJobs.map((j) => {
      const types = j.jobTypeAssignments.map((a) => a.jobType).sort();
      const tripOk = j.trips.every(
        (t) => t.tripType && types.includes(t.tripType),
      );
      const compatNull = j.jobType == null;
      if (!compatNull) incomplete.push(`${j.externalRef} jobType must be null`);
      if (!tripOk) incomplete.push(`${j.externalRef} tripType membership failed`);
      if (types.length < 2) incomplete.push(`${j.externalRef} missing multi types`);
      return {
        externalRef: j.externalRef,
        jobId: redactId(j.id),
        jobTypeCompatibility: j.jobType,
        jobTypes: types,
        trips: j.trips.map((t) => ({
          title: t.title,
          tripType: t.tripType,
          tripId: redactId(t.id),
        })),
        ok: compatNull && tripOk && types.length >= 2,
      };
    });

    // Finance not on driver/transport-only endpoints (static source check)
    const fs = await import("node:fs");
    const path = await import("node:path");
    const driverAppDir = path.join(
      __dirname,
      "../src/transport/driver-app",
    );
    const driverFiles = fs
      .readdirSync(driverAppDir)
      .filter((f) => f.endsWith(".ts"));
    let financeLeak = false;
    for (const file of driverFiles) {
      const text = fs.readFileSync(path.join(driverAppDir, file), "utf8");
      if (
        /JobFinanceSummary|financeStatus|invoiceRevenueCents/.test(text) &&
        !file.includes("expense")
      ) {
        financeLeak = true;
        incomplete.push(`Finance fields referenced in driver-app/${file}`);
      }
    }

    const expenses = await prisma.tripExpense.findMany({
      where: {
        tenantId: tenant.id,
        remarks: { startsWith: DEMO_PREFIX },
      },
      select: {
        id: true,
        remarks: true,
        reviewStatus: true,
        paymentMethod: true,
        reimbursementStatus: true,
        amountCents: true,
        attachments: { where: { isActive: true }, select: { id: true } },
      },
    });

    console.log(
      JSON.stringify(
        {
          prefix: DEMO_PREFIX,
          operatingDate,
          timezone,
          context: {
            tenant: {
              id: redactId(tenant.id),
              slug: tenant.slug,
            },
            customer: {
              id: redactId(customer.id),
              name: customer.name,
            },
            drivers: {
              A: { id: redactId(driverA.id), userId: redactId(driverA.userId) },
              B: { id: redactId(driverB.id), userId: redactId(driverB.userId) },
              C: { id: redactId(driverC.id), userId: redactId(driverC.userId) },
            },
            vehicles: {
              A: redactId(vehA.id),
              B: redactId(vehB.id),
              C: redactId(vehC.id),
            },
          },
          recordCounts: counts,
          financeScenarios: financeReport,
          negativeJobCount: negativeCount,
          todaysRoutePlanningTrips: {
            activeCount: activePlanning.length,
            driverA: laneA.map((t) => ({
              tripId: redactId(t.id),
              title: t.title,
              status: t.status,
              dispatchSequence: t.dispatchSequence,
              tripSequence: t.tripSequence,
              jobSequence: t.jobSequence,
              tripType: t.tripType,
            })),
            driverB: laneB.map((t) => ({
              tripId: redactId(t.id),
              title: t.title,
              status: t.status,
              dispatchSequence: t.dispatchSequence,
              locked: isDispatchSequenceLocked(t.status),
              tripType: t.tripType,
            })),
            driverC: laneC.map((t) => ({
              tripId: redactId(t.id),
              title: t.title,
              status: t.status,
              dispatchSequence: t.dispatchSequence,
            })),
            unassigned: unassigned.map((t) => ({
              tripId: redactId(t.id),
              title: t.title,
              status: t.status,
            })),
            excludedToday: todayTrips
              .filter((t) => PLANNING_EXCLUDED.includes(t.status as TripStatus))
              .map((t) => ({
                tripId: redactId(t.id),
                title: t.title,
                status: t.status,
              })),
            suggestSequence: {
              advisoryOnly: true,
              persisted: false,
              orderChanged,
              suggestedOrder: suggested.map(redactId),
              algorithm: nn.algorithm,
            },
          },
          documentReadiness: docCases,
          multiTypeJobs: multiReport,
          expenses: expenses.map((e) => ({
            id: redactId(e.id),
            key: e.remarks,
            reviewStatus: e.reviewStatus,
            paymentMethod: e.paymentMethod,
            reimbursementStatus: e.reimbursementStatus,
            amountCents: e.amountCents,
            receiptCount: e.attachments.length,
          })),
          financeNotOnDriverEndpoints: !financeLeak,
          incompleteScenarios: incomplete,
        },
        null,
        2,
      ),
    );

    if (incomplete.length) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
