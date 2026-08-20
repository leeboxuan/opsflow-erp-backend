/**
 * Create run-owned UAT test data for Playwright E2E.
 *
 *   OPSFLOW_E2E_ALLOW_MUTATIONS=true \
 *   npx dotenv -e .env -- npx ts-node --transpile-only scripts/e2e-uat-run-setup.ts
 */
import {
  CanonicalTenantRole,
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
  assertMutationsAllowedOrStop,
  assertUatOrStop,
  assertValidRunId,
  DriverPsaSnapshot,
  redactManifestSummary,
  resolveRunId,
  runInvoiceNo,
  runKey,
  runStorageKey,
  RUN_ID_ENV,
  tenantSlug,
  UatRunManifest,
  writeManifest,
} from "./e2e-uat-run-lib";

type Loc = { label: string; address: string; postal: string; lat: number; lng: number };
type DriverPick = { id: string; userId: string; email: string; hasPsaPortAccess: boolean };

const loc = (label: string, address: string, postal: string, lat: number, lng: number): Loc => ({
  label, address, postal, lat, lng,
});
const SG = {
  clementi: loc("Clementi Hub", "20 Toh Guan Rd", "608838", 1.3162, 103.7649),
  geylang: loc("Geylang WH", "100 Aljunied Rd", "389837", 1.3201, 103.8918),
  tuas: loc("Tuas Port", "Tuas Port Boulevard", "637551", 1.2685, 103.6512),
  pasir: loc("PSA Pasir Panjang", "Pasir Panjang Terminal", "118507", 1.2741, 103.7912),
  jurong: loc("Jurong East", "1 Venture Ave", "608521", 1.3332, 103.7422),
  tampines: loc("Tampines Ind", "2 Tampines Ind Ave 5", "528830", 1.3526, 103.9447),
};

async function main() {
  assertUatOrStop();
  assertMutationsAllowedOrStop();
  const runId = resolveRunId();
  assertValidRunId(runId);
  process.env[RUN_ID_ENV] = runId;

  const prisma = new PrismaClient();
  const jobIds: Record<string, string> = {};
  const tripIds: Record<string, string> = {};
  const expenseIds: Record<string, string> = {};
  const invoiceNos: string[] = [];
  const scenarios: Record<string, string> = {};

  const createJob = async (p: {
    suffix: string;
    jobTypes: JobType[];
    status?: JobStatus;
    pickup: Loc;
    delivery: Loc;
    description: string;
    tenantId: string;
    customerCompanyId: string;
    pickupDate: Date;
  }) => {
    const job = await prisma.job.create({
      data: {
        tenantId: p.tenantId,
        customerCompanyId: p.customerCompanyId,
        internalRef: runKey(runId, `INT/${p.suffix}`),
        externalRef: runKey(runId, p.suffix),
        jobType: p.jobTypes.length === 1 ? p.jobTypes[0]! : null,
        status: p.status ?? JobStatus.ONGOING,
        pickupDate: p.pickupDate,
        pickupAddress1: p.pickup.address,
        pickupPostal: p.pickup.postal,
        pickupContactName: "E2E UAT PIC",
        pickupContactPhone: "+65 6000 1001",
        deliveryAddress1: p.delivery.address,
        deliveryPostal: p.delivery.postal,
        receiverName: "E2E UAT Receiver",
        receiverPhone: "+65 6000 1002",
        notes: `${runId} seeded job`,
        description: p.description,
        invoiceReadyAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.jobTypeAssignment.createMany({
      data: p.jobTypes.map((jobType) => ({ tenantId: p.tenantId, jobId: job.id, jobType })),
    });
    return job.id;
  };

  const createTrip = async (p: {
    jobId: string;
    titleSuffix: string;
    tripType: JobType;
    status: TripStatus;
    seq: number;
    plannedStartAt: Date;
    origin: Loc;
    destination: Loc;
    tenantId: string;
    assignedDriverUserId?: string | null;
    driverId?: string | null;
    vehicleId?: string | null;
    requiresPsaPortAccess?: boolean;
    dispatchSequence?: number | null;
    displayTitle?: string;
  }) => {
    const trip = await prisma.trip.create({
      data: {
        tenantId: p.tenantId,
        jobId: p.jobId,
        status: p.status,
        tripType: p.tripType,
        tripSequence: p.seq,
        jobSequence: p.seq,
        routeVersion: 1,
        dispatchSequence: p.dispatchSequence ?? null,
        dispatchVersion: 1,
        plannedStartAt: p.plannedStartAt,
        title: runKey(runId, p.titleSuffix),
        displayTitle: p.displayTitle ?? p.titleSuffix,
        notes: runId,
        requiresPsaPortAccess: p.requiresPsaPortAccess === true,
        assignedDriverUserId: p.assignedDriverUserId ?? null,
        driverId: p.driverId ?? null,
        vehicleId: p.vehicleId ?? null,
        assignedAt: p.assignedDriverUserId ? new Date() : null,
        publishedAt: p.status === TripStatus.DRAFT ? null : new Date(),
        startedAt:
          p.status === TripStatus.ONGOING || p.status === TripStatus.COMPLETED
            ? new Date()
            : null,
        closedAt: p.status === TripStatus.COMPLETED ? new Date() : null,
        originLabel: p.origin.label,
        originAddressLine1: p.origin.address,
        originPostalCode: p.origin.postal,
        originCountry: "SG",
        originLat: p.origin.lat,
        originLng: p.origin.lng,
        destinationLabel: p.destination.label,
        destinationAddressLine1: p.destination.address,
        destinationPostalCode: p.destination.postal,
        destinationCountry: "SG",
        destinationLat: p.destination.lat,
        destinationLng: p.destination.lng,
      },
      select: { id: true },
    });
    return trip.id;
  };

  const createPayout = async (tenantId: string, tripId: string, amountCents: number, labelSuffix: string) => {
    await prisma.tripPayoutLine.create({
      data: {
        tenantId, tripId,
        sourceType: JobChargeSourceType.MANUAL,
        label: runKey(runId, labelSuffix),
        code: `${runId}-PAY`.slice(0, 64),
        quantity: 1, amountCents, totalCents: amountCents,
        isManual: true, isSelectableForTripEarning: true, sortOrder: 0,
      },
    });
    await prisma.trip.update({ where: { id: tripId }, data: { driverEarningCents: amountCents } });
  };

  const createCharge = async (tenantId: string, jobId: string, codeSuffix: string, amountCents: number, label: string) =>
    (await prisma.jobCharge.create({
      data: {
        tenantId, jobId, sourceType: JobChargeSourceType.MANUAL,
        code: `${runId}-${codeSuffix}`.slice(0, 64), label,
        qty: 1, unitPriceCents: amountCents, amountCents,
        currency: "SGD", taxable: false, taxCode: "ZR", taxRateBasisPoints: 0, sortOrder: 0,
      },
      select: { id: true },
    })).id;

  const createInvoice = async (p: {
    tenantId: string; customerName: string; customerCompanyId: string;
    invoiceNo: string; status: InvoiceStatus; sourceJobId: string;
    jobChargeId: string; amountCents: number;
  }) => {
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: p.tenantId, invoiceNo: p.invoiceNo, customerName: p.customerName,
        customerCompanyId: p.customerCompanyId, sourceJobId: p.sourceJobId,
        currency: "SGD", status: p.status,
        subtotalCents: p.amountCents, taxCents: 0, totalCents: p.amountCents,
        issuedAt: p.status === InvoiceStatus.ISSUED || p.status === InvoiceStatus.PAID ? new Date() : null,
        paidAt: p.status === InvoiceStatus.PAID ? new Date() : null,
        lockedAt: p.status === InvoiceStatus.ISSUED || p.status === InvoiceStatus.PAID ? new Date() : null,
        notes: runId,
      },
      select: { id: true },
    });
    await prisma.invoiceLineItem.create({
      data: {
        tenantId: p.tenantId, invoiceId: invoice.id, description: p.invoiceNo,
        qty: 1, unitPriceCents: p.amountCents, amountCents: p.amountCents,
        taxCode: "ZR", taxRate: 0, taxCents: 0, sourceType: "JOB", jobChargeId: p.jobChargeId,
      },
    });
    await prisma.invoiceChargeReservation.create({
      data: { tenantId: p.tenantId, invoiceId: invoice.id, jobChargeId: p.jobChargeId },
    });
  };

  const setDocReqs = async (tenantId: string, tripId: string, withDocs: boolean) => {
    const rows = [
      { type: TripDocumentType.DELIVERY_DO, label: "Delivery DO", requiresSignature: true, sortOrder: 0 },
      { type: TripDocumentType.POD_PHOTO, label: "POD Photo", requiresSignature: false, sortOrder: 1 },
    ];
    for (const row of rows) {
      await prisma.tripDocumentRequirement.create({
        data: {
          tenantId, tripId, type: row.type, label: row.label,
          isRequired: true, requiresSignature: row.requiresSignature, minCount: 1, sortOrder: row.sortOrder,
          responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
          requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
        },
      });
    }
    if (!withDocs) return;
    for (const row of rows) {
      await prisma.tripDocument.create({
        data: {
          tenantId, tripId, type: row.type,
          storageKey: runStorageKey(runId, "docs", `${row.type}.png`),
          originalName: `${row.type}.png`, mimeType: "image/png", sizeBytes: 68, isActive: true,
          isSigned: row.requiresSignature, signedAt: row.requiresSignature ? new Date() : null,
          requiresSignature: row.requiresSignature,
        },
      });
    }
  };

  const createExpense = async (p: {
    tenantId: string; jobId: string; tripId: string; userId: string; driverId: string;
    suffix: string; category: TripExpenseCategory; amountCents: number;
    reviewStatus: TripExpenseReviewStatus; reimbursementStatus: TripExpenseReimbursementStatus;
    reviewedByUserId?: string | null; reviewReason?: string | null;
  }) => {
    const expense = await prisma.tripExpense.create({
      data: {
        tenantId: p.tenantId, jobId: p.jobId, tripId: p.tripId,
        submittedByUserId: p.userId, submittedByDriverId: p.driverId,
        category: p.category, paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
        amountCents: p.amountCents, currency: "SGD", transactionDate: new Date(),
        remarks: runKey(runId, p.suffix),
        reviewStatus: p.reviewStatus, reimbursementStatus: p.reimbursementStatus,
        reviewReason: p.reviewReason ?? null,
        reviewedByUserId: p.reviewedByUserId ?? null,
        reviewedAt: p.reviewedByUserId ? new Date() : null,
      },
      select: { id: true },
    });
    await prisma.tripExpenseEvent.create({
      data: {
        tenantId: p.tenantId, expenseId: expense.id, actorUserId: p.userId,
        action: TripExpenseEventAction.SUBMITTED, newStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      },
    });
    await prisma.tripExpenseAttachment.create({
      data: {
        tenantId: p.tenantId, expenseId: expense.id,
        storageKey: runStorageKey(runId, "receipts", `${p.suffix}.png`),
        originalName: "synthetic-receipt.png", mimeType: "image/png", sizeBytes: 68,
        uploadedByUserId: p.userId, isActive: true,
      },
    });
    return expense.id;
  };

  try {
    const slug = tenantSlug();
    const tenant = await prisma.tenant.findFirst({
      where: { slug, status: "ACTIVE" },
      select: { id: true, slug: true, timezone: true },
    });
    if (!tenant) throw new Error(`STOP: ACTIVE tenant ${slug} not found`);

    const timezone = tenant.timezone || "Asia/Singapore";
    const operatingDate = todayOperatingDate(timezone);
    const midday = new Date(`${operatingDate}T04:00:00.000Z`);

    let customer = await prisma.customer_companies.findFirst({
      where: { tenantId: tenant.id, isActive: true, commercialStatus: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    let customerCreated = false;
    if (!customer) {
      const name = `E2E UAT Customer ${runId}`;
      customer = await prisma.customer_companies.create({
        data: {
          tenantId: tenant.id, name,
          normalizedName: name.toLowerCase().replace(/\s+/g, " ").trim(),
          isActive: true, commercialStatus: "ACTIVE", notes: runId, country: "SG",
          email: `uat-run+${runId.toLowerCase()}@example.invalid`,
        },
        select: { id: true, name: true },
      });
      customerCreated = true;
    }

    const memberships = await prisma.tenantMembership.findMany({
      where: {
        tenantId: tenant.id, status: "Active",
        OR: [
          { role: Role.DRIVER },
          { membershipRoles: { some: { role: CanonicalTenantRole.TRANSPORT_DRIVER } } },
        ],
      },
      select: { userId: true },
    });
    const driverUserIds = [...new Set(memberships.map((m) => m.userId))];
    if (driverUserIds.length < 2) throw new Error("STOP: need at least 2 DRIVER memberships");

    const driverRows = await prisma.drivers.findMany({
      where: { tenantId: tenant.id, userId: { in: driverUserIds } },
      select: { id: true, userId: true, email: true, hasPsaPortAccess: true },
    });
    const emailA = String(process.env.E2E_DRIVER_A_EMAIL ?? "").trim().toLowerCase();
    const emailB = String(process.env.E2E_DRIVER_B_EMAIL ?? "").trim().toLowerCase();
    const picks: DriverPick[] = [];
    const used = new Set<string>();
    const prefer = (email: string) => {
      if (!email) return;
      const hit = driverRows.find((d) => d.userId && d.email.toLowerCase() === email && !used.has(d.userId));
      if (!hit?.userId) return;
      used.add(hit.userId);
      picks.push({ id: hit.id, userId: hit.userId, email: hit.email, hasPsaPortAccess: hit.hasPsaPortAccess === true });
    };
    prefer(emailA);
    prefer(emailB);
    for (const d of driverRows) {
      if (picks.length >= 2) break;
      if (!d.userId || used.has(d.userId)) continue;
      used.add(d.userId);
      picks.push({ id: d.id, userId: d.userId, email: d.email, hasPsaPortAccess: d.hasPsaPortAccess === true });
    }
    if (picks.length < 2) throw new Error("STOP: could not resolve two driver profiles");
    const drivers = { A: picks[0]!, B: picks[1]! };

    const psaPrevious: { A: DriverPsaSnapshot; B: DriverPsaSnapshot } = {
      A: {
        driverId: drivers.A.id, userId: drivers.A.userId, email: drivers.A.email,
        previousHasPsaPortAccess: drivers.A.hasPsaPortAccess, appliedHasPsaPortAccess: true,
      },
      B: {
        driverId: drivers.B.id, userId: drivers.B.userId, email: drivers.B.email,
        previousHasPsaPortAccess: drivers.B.hasPsaPortAccess, appliedHasPsaPortAccess: false,
      },
    };
    await prisma.drivers.update({ where: { id: drivers.A.id }, data: { hasPsaPortAccess: true } });
    await prisma.drivers.update({ where: { id: drivers.B.id }, data: { hasPsaPortAccess: false } });

    const vehicleId = (await prisma.vehicle.findFirst({
      where: { tenantId: tenant.id, status: "ACTIVE" },
      select: { id: true }, orderBy: { createdAt: "asc" },
    }))?.id ?? null;
    const opsUserId = (await prisma.tenantMembership.findFirst({
      where: {
        tenantId: tenant.id, status: "Active",
        role: { in: [Role.TRANSPORT_STAFF, Role.ADMIN, Role.OPS, Role.FINANCE] },
      },
      select: { userId: true },
    }))?.userId ?? drivers.A.userId;

    const jobBase = {
      tenantId: tenant.id, customerCompanyId: customer.id, pickupDate: midday,
    };
    const tripBase = { tenantId: tenant.id, plannedStartAt: midday, vehicleId };

    // 1) Negative payout
    {
      const jobId = await createJob({
        ...jobBase, suffix: "FIN/NEG-PAYOUT", jobTypes: [JobType.LCL],
        status: JobStatus.COMPLETED, pickup: SG.clementi, delivery: SG.geylang,
        description: "Negative finance via payout > issued revenue",
      });
      jobIds.FIN_NEG = jobId; scenarios.negative_payout = jobId;
      const tripId = await createTrip({
        ...tripBase, jobId, titleSuffix: "FIN/NEG-PAYOUT/TRIP", tripType: JobType.LCL,
        status: TripStatus.COMPLETED, seq: 1, origin: SG.clementi, destination: SG.geylang,
        assignedDriverUserId: drivers.A.userId, driverId: drivers.A.id,
      });
      tripIds.FIN_NEG = tripId;
      await createPayout(tenant.id, tripId, 15000, "PAY/NEG");
      const chargeId = await createCharge(tenant.id, jobId, "CHG-NEG", 5000, "Trucking");
      const invNo = runInvoiceNo(runId, "INV-NEG");
      invoiceNos.push(invNo);
      await createInvoice({
        tenantId: tenant.id, customerName: customer.name, customerCompanyId: customer.id,
        invoiceNo: invNo, status: InvoiceStatus.ISSUED, sourceJobId: jobId,
        jobChargeId: chargeId, amountCents: 5000,
      });
    }

    // 2) Profitable + expenses
    {
      const jobId = await createJob({
        ...jobBase, suffix: "FIN/PROFITABLE", jobTypes: [JobType.EXPORT],
        status: JobStatus.COMPLETED, pickup: SG.jurong, delivery: SG.tuas,
        description: "Profitable + expense review states",
      });
      jobIds.FIN_PROFIT = jobId; scenarios.profitable = jobId;
      const tripId = await createTrip({
        ...tripBase, jobId, titleSuffix: "FIN/PROFITABLE/TRIP", tripType: JobType.EXPORT,
        status: TripStatus.COMPLETED, seq: 1, origin: SG.jurong, destination: SG.tuas,
        assignedDriverUserId: drivers.A.userId, driverId: drivers.A.id,
      });
      tripIds.FIN_PROFIT = tripId;
      await createPayout(tenant.id, tripId, 3000, "PAY/PROFIT");
      const chargeId = await createCharge(tenant.id, jobId, "CHG-PROFIT", 20000, "Export trucking");
      const invNo = runInvoiceNo(runId, "INV-PROFIT");
      invoiceNos.push(invNo);
      await createInvoice({
        tenantId: tenant.id, customerName: customer.name, customerCompanyId: customer.id,
        invoiceNo: invNo, status: InvoiceStatus.PAID, sourceJobId: jobId,
        jobChargeId: chargeId, amountCents: 20000,
      });

      const exp = {
        tenantId: tenant.id, jobId, tripId, userId: drivers.A.userId, driverId: drivers.A.id,
      };
      expenseIds.SUBMITTED = await createExpense({
        ...exp, suffix: "EXP/SUBMITTED", category: TripExpenseCategory.FUEL, amountCents: 2500,
        reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
        reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
      });
      expenseIds.APPROVED = await createExpense({
        ...exp, suffix: "EXP/APPROVED", category: TripExpenseCategory.PARKING, amountCents: 1200,
        reviewStatus: TripExpenseReviewStatus.APPROVED,
        reimbursementStatus: TripExpenseReimbursementStatus.PENDING, reviewedByUserId: opsUserId,
      });
      expenseIds.REJECTED = await createExpense({
        ...exp, suffix: "EXP/REJECTED", category: TripExpenseCategory.MISCELLANEOUS, amountCents: 999,
        reviewStatus: TripExpenseReviewStatus.REJECTED,
        reimbursementStatus: TripExpenseReimbursementStatus.NOT_REQUIRED,
        reviewedByUserId: opsUserId, reviewReason: `${runId} synthetic rejection`,
      });
      expenseIds.NEEDS_CLARIFICATION = await createExpense({
        ...exp, suffix: "EXP/NEEDS-CLARIFICATION", category: TripExpenseCategory.MEAL, amountCents: 1500,
        reviewStatus: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
        reimbursementStatus: TripExpenseReimbursementStatus.PENDING,
        reviewedByUserId: opsUserId, reviewReason: `${runId} please clarify synthetic receipt`,
      });
      scenarios.expense_submitted = expenseIds.SUBMITTED;
      scenarios.expense_approved = expenseIds.APPROVED;
      scenarios.expense_rejected = expenseIds.REJECTED;
      scenarios.expense_needs_clarification = expenseIds.NEEDS_CLARIFICATION;
    }

    // 3) Not invoiced
    {
      const jobId = await createJob({
        ...jobBase, suffix: "FIN/NOT-INVOICED", jobTypes: [JobType.IMPORT],
        status: JobStatus.READY_FOR_INVOICE, pickup: SG.pasir, delivery: SG.tampines,
        description: "Completed-ish, no invoice",
      });
      jobIds.FIN_NOT_INV = jobId; scenarios.not_invoiced = jobId;
      const tripId = await createTrip({
        ...tripBase, jobId, titleSuffix: "FIN/NOT-INVOICED/TRIP", tripType: JobType.IMPORT,
        status: TripStatus.COMPLETED, seq: 1, origin: SG.pasir, destination: SG.tampines,
        assignedDriverUserId: drivers.B.userId, driverId: drivers.B.id,
      });
      tripIds.FIN_NOT_INV = tripId;
      await createPayout(tenant.id, tripId, 4000, "PAY/NOT-INV");
      await createCharge(tenant.id, jobId, "CHG-NOT-INV", 9000, "Import trucking");
    }

    // 4) Multi-type + docs
    {
      const jobId = await createJob({
        ...jobBase, suffix: "MULTI/IMP-EXP", jobTypes: [JobType.IMPORT, JobType.EXPORT],
        pickup: SG.pasir, delivery: SG.tuas, description: "IMPORT+EXPORT; doc missing + ready",
      });
      jobIds.MULTI = jobId; scenarios.multi_type = jobId;

      const missingId = await createTrip({
        ...tripBase, jobId, titleSuffix: "MULTI/DOC-MISSING", tripType: JobType.IMPORT,
        status: TripStatus.PUBLISHED, seq: 1, dispatchSequence: 1,
        origin: SG.pasir, destination: SG.tampines,
        assignedDriverUserId: drivers.A.userId, driverId: drivers.A.id, displayTitle: "DOC missing",
      });
      tripIds.DOC_MISSING = missingId; scenarios.doc_missing = missingId;
      await setDocReqs(tenant.id, missingId, false);

      const readyId = await createTrip({
        ...tripBase, jobId, titleSuffix: "MULTI/DOC-READY", tripType: JobType.EXPORT,
        status: TripStatus.PUBLISHED, seq: 2, dispatchSequence: 2,
        origin: SG.jurong, destination: SG.tuas,
        assignedDriverUserId: drivers.A.userId, driverId: drivers.A.id, displayTitle: "DOC ready",
      });
      tripIds.DOC_READY = readyId; scenarios.doc_ready = readyId;
      await setDocReqs(tenant.id, readyId, true);
    }

    // 5) PSA
    {
      const jobId = await createJob({
        ...jobBase, suffix: "PSA/LANES", jobTypes: [JobType.IMPORT],
        pickup: SG.pasir, delivery: SG.geylang, description: "PSA A ok, B conflict, unassigned",
      });
      jobIds.PSA = jobId; scenarios.psa_job = jobId;

      tripIds.PSA_A = await createTrip({
        ...tripBase, jobId, titleSuffix: "PSA/ASSIGNED-A", tripType: JobType.IMPORT,
        status: TripStatus.PUBLISHED, seq: 1, dispatchSequence: 1,
        origin: SG.pasir, destination: SG.geylang,
        assignedDriverUserId: drivers.A.userId, driverId: drivers.A.id,
        requiresPsaPortAccess: true, displayTitle: "PSA on A",
      });
      scenarios.psa_assigned_a = tripIds.PSA_A;

      tripIds.PSA_B_CONFLICT = await createTrip({
        ...tripBase, jobId, titleSuffix: "PSA/CONFLICT-B", tripType: JobType.IMPORT,
        status: TripStatus.PUBLISHED, seq: 2, dispatchSequence: 1,
        origin: SG.pasir, destination: SG.clementi,
        assignedDriverUserId: drivers.B.userId, driverId: drivers.B.id,
        requiresPsaPortAccess: true, displayTitle: "PSA conflict on B",
      });
      scenarios.psa_conflict_b = tripIds.PSA_B_CONFLICT;

      tripIds.PSA_UNASSIGNED = await createTrip({
        ...tripBase, jobId, titleSuffix: "PSA/UNASSIGNED", tripType: JobType.IMPORT,
        status: TripStatus.DRAFT, seq: 3, origin: SG.pasir, destination: SG.tampines,
        requiresPsaPortAccess: true, displayTitle: "PSA unassigned",
      });
      scenarios.psa_unassigned = tripIds.PSA_UNASSIGNED;
    }

    // 6) B lane + ONGOING lock
    {
      const jobId = await createJob({
        ...jobBase, suffix: "LANE/B", jobTypes: [JobType.LCL],
        pickup: SG.clementi, delivery: SG.jurong, description: "Non-PSA on B + ONGOING lock",
      });
      jobIds.LANE_B = jobId; scenarios.lane_b = jobId;

      tripIds.NON_PSA_B = await createTrip({
        ...tripBase, jobId, titleSuffix: "LANE/B/NON-PSA", tripType: JobType.LCL,
        status: TripStatus.PUBLISHED, seq: 1, dispatchSequence: 2,
        origin: SG.clementi, destination: SG.jurong,
        assignedDriverUserId: drivers.B.userId, driverId: drivers.B.id, displayTitle: "Non-PSA on B",
      });
      scenarios.non_psa_b = tripIds.NON_PSA_B;

      tripIds.ONGOING_LOCK = await createTrip({
        ...tripBase, jobId, titleSuffix: "LANE/B/ONGOING-LOCK", tripType: JobType.LCL,
        status: TripStatus.ONGOING, seq: 2, dispatchSequence: 1,
        origin: SG.geylang, destination: SG.tampines,
        assignedDriverUserId: drivers.B.userId, driverId: drivers.B.id, displayTitle: "ONGOING lock",
      });
      scenarios.ongoing_lock = tripIds.ONGOING_LOCK;
    }

    const manifest: UatRunManifest = {
      runId, operatingDate, tenantId: tenant.id, tenantSlug: tenant.slug,
      customerCompanyId: customer.id, customerCompanyCreated: customerCreated,
      jobIds, tripIds, expenseIds, invoiceNos,
      driverUserIds: { A: drivers.A.userId, B: drivers.B.userId },
      driverIds: { A: drivers.A.id, B: drivers.B.id },
      psaPrevious, scenarios, createdAt: new Date().toISOString(),
    };
    writeManifest(manifest);
    console.log(JSON.stringify({
      ok: true,
      summary: redactManifestSummary(manifest),
      hint: `Set ${RUN_ID_ENV}=${runId} for cleanup`,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
