import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  JobMessageImportBatchStatus,
  JobMessageImportDraftInclusionState,
  JobMessageImportDraftValidationStatus,
  JobMessageImportMovementType,
  JobMessageImportSourceChannel,
} from "@prisma/client";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { AuditService } from "../../../shared/audit/audit.service";
import { TransportJobsService } from "../transport-jobs.service";
import {
  JobMessageParser,
  type JobMessageImportParsedDraft,
  type ParseJobMessageResult,
} from "./job-message-parser";
import {
  JOB_MESSAGE_IMPORT_MAX_INPUT_CHARS,
  JOB_MESSAGE_PARSER_TOKEN,
  FAKE_JOB_MESSAGE_PARSER_VERSION,
  JOB_MESSAGE_IMPORT_CONFIRM_TX_MAX_WAIT_MS,
  JOB_MESSAGE_IMPORT_CONFIRM_TX_TIMEOUT_MS,
  JOB_MESSAGE_IMPORT_FINALIZE_CONCURRENCY,
} from "./job-message-import.constants";
import { assertSourceFragmentsTraceable } from "./job-message-import.source-fidelity";
import { mapParserError } from "./job-message-import.parser-http-errors";
import { JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE } from "./job-message-parser.factory";
import {
  computeBatchFingerprint,
  computeDraftFingerprint,
} from "./job-message-import.fingerprint";
import { findDuplicateCandidates, findDuplicateCandidatesForDrafts } from "./job-message-import.duplicates";
import { reviewedDraftToCreateJobDto } from "./job-message-import.mapping";
import {
  classifyValidationStatus,
  mergeReviewedDraftPatch,
  normalizeReviewedDraft,
  trimToNull,
  validateReviewedDraft,
} from "./job-message-import.validator";
import { ConfirmPerfTracker } from "./job-message-import-confirm-perf";
import { mapWithConcurrency } from "../bounded-concurrency";
import {
  parseReferenceDateForTimezone,
  requestedPickupDateYmd,
} from "./job-message-import.planning-date";
import { normalizeLocationLabel } from "./job-message-import.text-normalize";
import {
  extractLabelledInstructions,
  extractCargoItemsFromFragment,
  extractLabelledTiming,
  inferCollectionTypeFromFragment,
  mergeInstructions,
  splitLocationFromTiming,
} from "./job-message-import.labelled-fields";
import { parseOperationalTiming } from "./job-message-import.timing";
import { enrichAddressFields } from "./job-message-import.address-parse";
import { applyResolvedLocationsOntoReviewed, revalidateReviewedPlacesWithTrustedDetails } from "./job-message-import.location-verification";
import { sanitizeReviewedDraftForResponse } from "./job-message-import.repair";
import type {
  ControllerReviewedDraft,
  DuplicateCandidate,
  JobMessageImportConfirmResult,
  JobMessageImportConfirmWarning,
  JobMessageImportReviewResponse,
  ReviewableJobDraft,
} from "./job-message-import.types";
import type { ReviewedDraftPatch } from "./job-message-import.validator";
import { PlacesService } from "../../../shared/places/places.service";

export type JobMessageImportConfirmDraftInput = {
  draftId: string;
} & ReviewedDraftPatch & {
  duplicateOverrideAcknowledged?: boolean;
  duplicateOverrideReason?: string | null;
};

export type PatchDraftInput = {
  expectedDraftVersion: number;
} & ReviewedDraftPatch & {
  inclusionState?: JobMessageImportDraftInclusionState;
  duplicateOverrideAcknowledged?: boolean;
  duplicateOverrideReason?: string | null;
};

function toYmdString(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function mapParsedMovementType(
  mt: JobMessageImportParsedDraft["movementType"] | string,
): JobMessageImportMovementType {
  switch (mt) {
    case "COLLECTION":
      return JobMessageImportMovementType.COLLECTION;
    case "IMPORT":
      return JobMessageImportMovementType.IMPORT;
    case "EXPORT":
      return JobMessageImportMovementType.EXPORT;
    case "LCL":
      return JobMessageImportMovementType.LCL;
    case "RETURN":
      return JobMessageImportMovementType.RETURN;
    case "ONE_WAY":
      return JobMessageImportMovementType.ONE_WAY;
    default:
      return JobMessageImportMovementType.UNKNOWN;
  }
}

export function controllerJsonFromParsed(
  parsed: JobMessageImportParsedDraft,
  customerCompanyId: string | null,
  context?: { timezone: string; referenceDate?: string },
): ControllerReviewedDraft {
  const timezone = context?.timezone || "Asia/Singapore";
  const referenceDate = context?.referenceDate ?? parseReferenceDateForTimezone(timezone);

  const pickupSplit = splitLocationFromTiming(parsed.pickup?.rawText);
  const deliverySplit = splitLocationFromTiming(parsed.delivery?.rawText);

  const labelledTiming = extractLabelledTiming(parsed.sourceFragment);

  const timingText =
    trimToNull(parsed.timingText) ??
    pickupSplit.timingText ??
    deliverySplit.timingText ??
    labelledTiming.pickupTimingText ??
    labelledTiming.deliveryTimingText ??
    null;

  const pickupTimingSource =
    pickupSplit.timingText ??
    labelledTiming.pickupTimingText ??
    (deliverySplit.timingText || labelledTiming.deliveryTimingText ? null : timingText);

  const pickupTiming = parseOperationalTiming({
    text: pickupTimingSource,
    referenceDate,
    timezone,
  });
  const deliveryTiming = parseOperationalTiming({
    text: deliverySplit.timingText ?? labelledTiming.deliveryTimingText,
    referenceDate,
    timezone,
  });

  let resolvedPickupTiming = pickupTiming;
  let resolvedDeliveryTiming = deliveryTiming;

  if (
    !pickupSplit.timingText &&
    !deliverySplit.timingText &&
    !trimToNull(parsed.timingText)
  ) {
    const fromFragment = parseOperationalTiming({
      text: parsed.sourceFragment,
      referenceDate,
      timezone,
    });
    if (fromFragment.pickupDateLocal && !fromFragment.needsReview) {
      resolvedPickupTiming = fromFragment;
    }
  }

  const pickupEnriched = enrichAddressFields({
    address1:
      normalizeLocationLabel(pickupSplit.location) ||
      (resolvedPickupTiming.locationHint
        ? normalizeLocationLabel(resolvedPickupTiming.locationHint)
        : null),
    address2: null,
    postal: null,
  });
  const deliveryEnriched = enrichAddressFields({
    address1: normalizeLocationLabel(deliverySplit.location),
    address2: null,
    postal: null,
  });

  const instructions = mergeInstructions(
    Array.isArray(parsed.instructions) ? parsed.instructions : [],
    extractLabelledInstructions(parsed.sourceFragment),
  );

  const fragmentItems = extractCargoItemsFromFragment(parsed.sourceFragment);
  const parsedItems = (parsed.items ?? []).map((it) => ({
    containerNumber: it.containerNumber ?? null,
    sealNumber: it.sealNumber ?? null,
    referenceNumber: it.referenceNumber ?? null,
    quantity: it.quantity ?? null,
  }));
  const items =
    parsedItems.length > 0
      ? parsedItems
      : fragmentItems.map((it) => ({
          containerNumber: null,
          sealNumber: it.sealNumber,
          referenceNumber: it.referenceNumber,
          quantity: it.quantity,
        }));

  const movementType = mapParsedMovementType(parsed.movementType);
  const collectionType = inferCollectionTypeFromFragment(parsed.sourceFragment);

  const pickupSource =
    pickupSplit.location ?? parsed.pickup?.rawText ?? null;
  const deliverySource =
    deliverySplit.location ?? parsed.delivery?.rawText ?? null;

  let pickupAddress1 = pickupEnriched.address1;
  let pickupAddress2 = pickupEnriched.address2;
  let pickupPostal = pickupEnriched.postal;
  let pickupSourceText = pickupSource;
  let deliveryAddress1 = deliveryEnriched.address1;
  let deliveryAddress2 = deliveryEnriched.address2;
  let deliveryPostal = deliveryEnriched.postal;
  let deliverySourceText = deliverySource;
  let returningDepotAddress1: string | null = null;
  let returningDepotAddress2: string | null = null;
  let returningDepotPostal: string | null = null;
  let returningDepotSourceText: string | null = null;

  // RETURN destinations arrive as delivery.rawText ("to - cogent"). Map them onto
  // returningDepot* so review UI / depot matching see the extracted destination.
  if (movementType === JobMessageImportMovementType.RETURN) {
    returningDepotAddress1 = deliveryEnriched.address1 ?? deliverySource;
    returningDepotAddress2 = deliveryEnriched.address2;
    returningDepotPostal = deliveryEnriched.postal;
    returningDepotSourceText = deliverySource ?? deliveryEnriched.address1;
    deliveryAddress1 = null;
    deliveryAddress2 = null;
    deliveryPostal = null;
    deliverySourceText = null;
  }

  return normalizeReviewedDraft({
    movementType,
    collectionType,
    customerCompanyId,
    customerNameText: parsed.customerNameText ?? null,
    pickupAddress1,
    pickupAddress2,
    pickupPostal,
    pickupPlaceId: null,
    pickupLat: null,
    pickupLng: null,
    pickupSourceText,
    deliveryAddress1,
    deliveryAddress2,
    deliveryPostal,
    deliveryPlaceId: null,
    deliveryLat: null,
    deliveryLng: null,
    deliverySourceText,
    returningDepotAddress1,
    returningDepotAddress2,
    returningDepotPostal,
    returningDepotSourceText,
    pickupDateLocal: resolvedPickupTiming.pickupDateLocal,
    deliveryDateLocal: resolvedDeliveryTiming.pickupDateLocal,
    pickupDateDisplay: resolvedPickupTiming.display,
    deliveryDateDisplay: resolvedDeliveryTiming.display,
    pickupDateNeedsReview: resolvedPickupTiming.needsReview,
    deliveryDateNeedsReview: resolvedDeliveryTiming.needsReview,
    picName: parsed.picName ?? null,
    picPhone: parsed.picPhone ?? null,
    notes: parsed.notes ?? null,
    instructions,
    timingText,
    carrierName: parsed.carrier ?? null,
    shipper: parsed.shipper ?? null,
    vesselName: parsed.vessel ?? null,
    voyage: parsed.voyage ?? null,
    containerSizeType: parsed.containerSizeType ?? null,
    items,
    pickupReference:
      movementType === JobMessageImportMovementType.COLLECTION
        ? items.map((it) => it.referenceNumber).find((v) => !!v) ?? null
        : null,
  });
}

function readControllerJson(raw: unknown): ControllerReviewedDraft {
  const c = (raw ?? {}) as Partial<ControllerReviewedDraft>;
  return normalizeReviewedDraft({
    movementType: mapParsedMovementType(String(c.movementType ?? "UNKNOWN")),
    collectionType: (c.collectionType as ControllerReviewedDraft["collectionType"]) ?? null,
    customerCompanyId: c.customerCompanyId ?? null,
    customerNameText: c.customerNameText ?? null,
    pickupAddress1: c.pickupAddress1 ?? null,
    pickupAddress2: c.pickupAddress2 ?? null,
    pickupPostal: c.pickupPostal ?? null,
    pickupPlaceId: c.pickupPlaceId ?? null,
    pickupLat: c.pickupLat ?? null,
    pickupLng: c.pickupLng ?? null,
    deliveryAddress1: c.deliveryAddress1 ?? null,
    deliveryAddress2: c.deliveryAddress2 ?? null,
    deliveryPostal: c.deliveryPostal ?? null,
    deliveryPlaceId: c.deliveryPlaceId ?? null,
    deliveryLat: c.deliveryLat ?? null,
    deliveryLng: c.deliveryLng ?? null,
    portAddress1: c.portAddress1 ?? null,
    portAddress2: c.portAddress2 ?? null,
    portPostal: c.portPostal ?? null,
    portPlaceId: c.portPlaceId ?? null,
    portLat: c.portLat ?? null,
    portLng: c.portLng ?? null,
    returningDepotAddress1: c.returningDepotAddress1 ?? null,
    returningDepotAddress2: c.returningDepotAddress2 ?? null,
    returningDepotPostal: c.returningDepotPostal ?? null,
    returningDepotPlaceId: c.returningDepotPlaceId ?? null,
    returningDepotLat: c.returningDepotLat ?? null,
    returningDepotLng: c.returningDepotLng ?? null,
    returningDepotCode: c.returningDepotCode ?? null,
    returningDepotPending: c.returningDepotPending === true,
    returningDepotPendingText: c.returningDepotPendingText ?? null,
    pickupDateLocal: c.pickupDateLocal ?? null,
    deliveryDateLocal: c.deliveryDateLocal ?? null,
    pickupDateDisplay: c.pickupDateDisplay ?? null,
    deliveryDateDisplay: c.deliveryDateDisplay ?? null,
    pickupDateNeedsReview: c.pickupDateNeedsReview ?? false,
    deliveryDateNeedsReview: c.deliveryDateNeedsReview ?? false,
    picName: c.picName ?? null,
    picPhone: c.picPhone ?? null,
    notes: c.notes ?? null,
    instructions: c.instructions ?? [],
    timingText: c.timingText ?? null,
    carrierName: c.carrierName ?? null,
    shipper: c.shipper ?? null,
    vesselName: c.vesselName ?? null,
    voyage: c.voyage ?? null,
    containerSizeType: c.containerSizeType ?? null,
    autoTripDocumentRequirements: c.autoTripDocumentRequirements,
    items: c.items ?? [],
    pickupReference: (c as { pickupReference?: string | null }).pickupReference ?? null,
  });
}

function isUniqueConflict(e: any): boolean {
  return e?.code === "P2002";
}

@Injectable()
export class JobMessageImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(JOB_MESSAGE_PARSER_TOKEN) private readonly parser: JobMessageParser,
    private readonly jobs: TransportJobsService,
    private readonly places: PlacesService,
  ) {}

  private async loadImportLocationCatalogues() {
    const [ports, depots] = await Promise.all([
      this.prisma.masterSingaporePort.findMany(),
      this.prisma.masterSingaporeDepot.findMany(),
    ]);
    return {
      ports: ports.map((row) => ({
        code: row.code,
        name: row.name,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        postalCode: row.postalCode,
        placeId: row.placeId,
        lat: row.lat,
        lng: row.lng,
      })),
      depots: depots.map((row) => ({
        code: row.code,
        name: row.name,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        postalCode: row.postalCode,
        placeId: row.placeId,
        lat: row.lat,
        lng: row.lng,
      })),
    };
  }

  async createPreviewBatch(params: {
    tenantId: string;
    actorUserId: string | null;
    timezone: string;
    sourceChannel: JobMessageImportSourceChannel;
    sourceText: string;
    correlationId?: string | null;
  }): Promise<JobMessageImportReviewResponse> {
    if (!params.sourceText?.trim()) {
      throw new BadRequestException("sourceText is required");
    }
    if (params.sourceText.length > JOB_MESSAGE_IMPORT_MAX_INPUT_CHARS) {
      throw new BadRequestException("sourceText exceeds max input length");
    }

    const parserVersion = this.parser.getParserVersion();
    const batchFingerprint = computeBatchFingerprint({
      tenantId: params.tenantId,
      sourceChannel: params.sourceChannel,
      timezone: params.timezone,
      sourceText: params.sourceText,
      parserVersion,
    });

    const existingInReview = await this.prisma.jobMessageImportBatch.findFirst({
      where: {
        tenantId: params.tenantId,
        sourceFingerprint: batchFingerprint,
        status: JobMessageImportBatchStatus.IN_REVIEW,
      },
      orderBy: { createdAt: "desc" },
    });
    if (existingInReview) {
      return this.toReviewResponse(existingInReview.id, params.tenantId);
    }

    let parseResult: ParseJobMessageResult;
    try {
      parseResult = await this.parser.parse({
        tenantId: params.tenantId,
        timezone: params.timezone,
        sourceChannel: "WHATSAPP",
        sourceText: params.sourceText,
        correlationId: params.correlationId ?? undefined,
      });
    } catch (e: any) {
      mapParserError(e);
    }

    const parsed = parseResult.message;
    this.assertParsedMessageShape(parsed);
    this.assertProductionParserOutput(parsed);
    assertSourceFragmentsTraceable(params.sourceText, parsed.drafts);

    const customerByName = new Map<string, string>();
    const draftCustomerNames = parsed.drafts
      .map((d) => d.customerNameText)
      .filter((v): v is string => !!v && !!v.trim());
    for (const name of new Set(draftCustomerNames)) {
      const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
      const match = await this.prisma.customer_companies.findFirst({
        where: { tenantId: params.tenantId, normalizedName: normalized },
        select: { id: true },
      });
      if (match?.id) customerByName.set(name, match.id);
    }

    const referenceDate = parseReferenceDateForTimezone(params.timezone);

    const catalogues = await this.loadImportLocationCatalogues();

    const draftsToCreate = [];
    for (const d of parsed.drafts) {
      const customerId = d.customerNameText
        ? customerByName.get(d.customerNameText) ?? null
        : null;
      let reviewed = controllerJsonFromParsed(d, customerId, {
        timezone: params.timezone,
        referenceDate,
      });
      reviewed = normalizeReviewedDraft(
        applyResolvedLocationsOntoReviewed(reviewed, catalogues),
      );
      const duplicateFingerprint = computeDraftFingerprint({
        tenantId: params.tenantId,
        movementType: reviewed.movementType,
        reviewed,
      });
      const validation = validateReviewedDraft(reviewed);
      const candidates = await findDuplicateCandidates({
        tx: this.prisma,
        tenantId: params.tenantId,
        requestedPickupDateYmd: requestedPickupDateYmd(reviewed),
        reviewed,
        duplicateFingerprint,
      });
      const validationStatus = classifyValidationStatus({
        hasBlockingErrors: validation.hasBlockingErrors,
        duplicateCandidateCount: candidates.length,
        duplicateOverrideAcknowledged: false,
      });
      draftsToCreate.push({
        tenantId: params.tenantId,
        clientDraftId: d.clientDraftId,
        movementType: reviewed.movementType,
        sourceFragment: d.sourceFragment,
        duplicateFingerprint,
        validationStatus,
        inclusionState: JobMessageImportDraftInclusionState.INCLUDED,
        parsedJson: d as object,
        controllerJson: reviewed as object,
        fieldEvidenceJson: d.fieldEvidence as object,
        draftWarningsJson: validation.warnings as object,
      });
    }

    let batch: { id: string };
    try {
      batch = await this.prisma.jobMessageImportBatch.create({
        data: {
          tenantId: params.tenantId,
          createdByUserId: params.actorUserId,
          status: JobMessageImportBatchStatus.IN_REVIEW,
          sourceChannel: params.sourceChannel,
          timezone: params.timezone,
          sourceFingerprint: batchFingerprint,
          parserVersion,
          modelName: parseResult.meta.modelName,
          parserVersionNo: null,
          batchWarningsJson:
            (parsed.batchWarnings?.length ?? 0) > 0 ? (parsed.batchWarnings as object) : null,
          parseMetadataJson: parseResult.meta as object,
          drafts: { create: draftsToCreate },
        },
      });
    } catch (e: any) {
      if (!isUniqueConflict(e)) throw e;
      const winner = await this.prisma.jobMessageImportBatch.findFirst({
        where: {
          tenantId: params.tenantId,
          sourceFingerprint: batchFingerprint,
          status: JobMessageImportBatchStatus.IN_REVIEW,
        },
        orderBy: { createdAt: "desc" },
      });
      if (!winner) throw e;
      return this.toReviewResponse(winner.id, params.tenantId);
    }

    await this.audit.log(
      params.tenantId,
      "AI_JOB_MESSAGE_IMPORT_PREVIEW",
      "TENANT",
      batch.id,
      { sourceChannel: params.sourceChannel, timezone: params.timezone },
      params.actorUserId,
    );

    return this.toReviewResponse(batch.id, params.tenantId);
  }

  async getBatchPreview(params: {
    tenantId: string;
    batchId: string;
  }): Promise<JobMessageImportReviewResponse> {
    return this.toReviewResponse(params.batchId, params.tenantId);
  }

  async patchDraft(params: {
    tenantId: string;
    actorUserId: string | null;
    batchId: string;
    draftId: string;
    patch: PatchDraftInput;
  }): Promise<JobMessageImportReviewResponse> {
    const batch = await this.prisma.jobMessageImportBatch.findFirst({
      where: { tenantId: params.tenantId, id: params.batchId },
    });
    if (!batch) throw new NotFoundException("Batch not found");
    if (batch.status !== JobMessageImportBatchStatus.IN_REVIEW) {
      throw new BadRequestException("Confirmed batches are immutable");
    }

    const draft = await this.prisma.jobMessageImportDraft.findFirst({
      where: {
        tenantId: params.tenantId,
        batchId: params.batchId,
        id: params.draftId,
      },
    });
    if (!draft) throw new NotFoundException("Draft not found");
    if (draft.confirmedAt) {
      throw new BadRequestException("Confirmed drafts are immutable");
    }

    const current = readControllerJson(draft.controllerJson);
    const catalogues = await this.loadImportLocationCatalogues();
    const nextReviewed = applyResolvedLocationsOntoReviewed(
      mergeReviewedDraftPatch(current, params.patch),
      catalogues,
    );

    if (nextReviewed.customerCompanyId) {
      const exists = await this.prisma.customer_companies.findFirst({
        where: { tenantId: params.tenantId, id: nextReviewed.customerCompanyId },
        select: { id: true },
      });
      if (!exists) {
        throw new BadRequestException("Customer is invalid for this tenant");
      }
    }

    const nextFingerprint = computeDraftFingerprint({
      tenantId: params.tenantId,
      movementType: nextReviewed.movementType,
      reviewed: nextReviewed,
    });
    const fingerprintChanged = nextFingerprint !== draft.duplicateFingerprint;
    const overrideAcknowledged = fingerprintChanged
      ? false
      : params.patch.duplicateOverrideAcknowledged === true
        ? true
        : params.patch.duplicateOverrideAcknowledged === false
          ? false
          : !!draft.duplicateOverrideAt;
    const overrideReason = fingerprintChanged
      ? null
      : params.patch.duplicateOverrideReason !== undefined
        ? params.patch.duplicateOverrideReason
        : draft.duplicateOverrideReason;

    const validation = validateReviewedDraft(nextReviewed);
    const candidates = await findDuplicateCandidates({
      tx: this.prisma,
      tenantId: params.tenantId,
      requestedPickupDateYmd: requestedPickupDateYmd(nextReviewed),
      reviewed: nextReviewed,
      duplicateFingerprint: nextFingerprint,
      excludeDraftId: draft.id,
    });
    const validationStatus = classifyValidationStatus({
      hasBlockingErrors: validation.hasBlockingErrors,
      duplicateCandidateCount: candidates.length,
      duplicateOverrideAcknowledged: overrideAcknowledged,
    });

    await this.prisma.$transaction(async (tx: any) => {
      const liveBatch = await tx.jobMessageImportBatch.findFirst({
        where: { tenantId: params.tenantId, id: params.batchId },
      });
      if (!liveBatch || liveBatch.status !== JobMessageImportBatchStatus.IN_REVIEW) {
        throw new BadRequestException("Confirmed batches are immutable");
      }
      const updated = await tx.jobMessageImportDraft.updateMany({
        where: {
          id: draft.id,
          tenantId: params.tenantId,
          version: params.patch.expectedDraftVersion,
          confirmedAt: null,
        },
        data: {
          movementType: nextReviewed.movementType,
          controllerJson: nextReviewed as object,
          duplicateFingerprint: nextFingerprint,
          validationStatus,
          inclusionState:
            params.patch.inclusionState ?? draft.inclusionState,
          draftWarningsJson: validation.warnings as object,
          version: { increment: 1 },
          duplicateOverrideReason: overrideAcknowledged
            ? overrideReason?.trim() || "Acknowledged possible duplicate"
            : null,
          duplicateOverrideActorUserId: overrideAcknowledged
            ? params.actorUserId
            : null,
          duplicateOverrideAt: overrideAcknowledged ? new Date() : null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: "STALE_VERSION",
          message: "Draft version is stale; please refresh.",
        });
      }
      await tx.jobMessageImportBatch.update({
        where: { id: batch.id },
        data: { version: { increment: 1 } },
      });
    });

    return this.toReviewResponse(batch.id, params.tenantId);
  }

  async confirmBatch(params: {
    tenantId: string;
    actorUserId: string | null;
    batchId: string;
    drafts: JobMessageImportConfirmDraftInput[];
  }): Promise<JobMessageImportConfirmResult> {
    const perf = new ConfirmPerfTracker();
    type ConfirmTxResult = {
      createdJobIds: string[];
      auditEvents: Array<{ jobId: string; draftId: string; clientDraftId: string }>;
      createdForFinalize: Array<{
        jobId: string;
        internalRef: string | null;
        dto: ReturnType<typeof reviewedDraftToCreateJobDto>;
      }>;
    };
    const batchLoadStarted = Date.now();
    const batch = await this.prisma.jobMessageImportBatch.findFirst({
      where: { tenantId: params.tenantId, id: params.batchId },
      include: { drafts: true },
    });
    perf.record("batchLoad", Date.now() - batchLoadStarted);
    if (!batch) throw new NotFoundException("Batch not found");

    if (batch.status === JobMessageImportBatchStatus.CONFIRMED) {
      const confirmedDrafts = batch.drafts.filter((d) => !!d.canonicalJobId);
      const warnings = await this.runPostCommitImportFinalization({
        tenantId: params.tenantId,
        actorUserId: params.actorUserId,
        batchId: params.batchId,
        timezone: batch.timezone,
        drafts: confirmedDrafts,
        perf,
      });
      perf.flush();
      return {
        createdJobIds: confirmedDrafts.map((d) => String(d.canonicalJobId)),
        createdCount: confirmedDrafts.length,
        warnings,
      };
    }
    if (batch.status !== JobMessageImportBatchStatus.IN_REVIEW) {
      throw new BadRequestException("Batch cannot be confirmed");
    }

    const submitted = params.drafts ?? [];
    if (!submitted.length) {
      throw new BadRequestException("No drafts to confirm");
    }
    const seenIds = new Set<string>();
    for (const row of submitted) {
      if (!row?.draftId || typeof row.draftId !== "string") {
        throw new BadRequestException("Each confirmed draft must include draftId");
      }
      if (seenIds.has(row.draftId)) {
        throw new BadRequestException("Duplicate draft IDs are not allowed");
      }
      seenIds.add(row.draftId);
    }

    const draftsById = new Map(batch.drafts.map((d) => [d.id, d] as const));
    const prepared: Array<{
      draft: (typeof batch.drafts)[number];
      reviewed: ControllerReviewedDraft;
      fingerprint: string;
      overrideAcknowledged: boolean;
      overrideReason: string | null;
    }> = [];

    await perf.measure("reviewedDraftValidation", async () => {
      const catalogues = await this.loadImportLocationCatalogues();
      for (const row of submitted) {
        const draft = draftsById.get(row.draftId) as (typeof batch.drafts)[number] | undefined;
        if (!draft) {
          throw new BadRequestException("Draft does not belong to this batch");
        }
        if (draft.confirmedAt) {
          throw new BadRequestException("Draft already confirmed");
        }
        const reviewed = await revalidateReviewedPlacesWithTrustedDetails(
          applyResolvedLocationsOntoReviewed(
            mergeReviewedDraftPatch(readControllerJson(draft.controllerJson), row),
            catalogues,
          ),
          async (placeId) => {
            try {
              const details = await this.places.details(placeId);
              return {
                postalCode: details.postalCode,
                formattedAddress: details.formattedAddress,
                addressLine1: details.addressLine1,
              };
            } catch {
              return null;
            }
          },
        );
        const validation = validateReviewedDraft(reviewed);
        if (validation.hasBlockingErrors) {
          throw new BadRequestException("Included drafts have unresolved validation errors");
        }
        const fingerprint = computeDraftFingerprint({
          tenantId: params.tenantId,
          movementType: reviewed.movementType,
          reviewed,
        });
        const fingerprintChanged = fingerprint !== draft.duplicateFingerprint;
        const overrideAcknowledged = fingerprintChanged
          ? row.duplicateOverrideAcknowledged === true
          : row.duplicateOverrideAcknowledged === true
            ? true
            : row.duplicateOverrideAcknowledged === false
              ? false
              : !!draft.duplicateOverrideAt;
        const overrideReason = overrideAcknowledged
          ? trimToNull(row.duplicateOverrideReason) ??
            draft.duplicateOverrideReason ??
            "Acknowledged possible duplicate"
          : null;
        prepared.push({
          draft,
          reviewed,
          fingerprint,
          overrideAcknowledged,
          overrideReason,
        });
      }
    });

    await perf.measure("customerValidation", async () => {
      const customerIds = Array.from(
        new Set(
          prepared
            .map((p) => p.reviewed.customerCompanyId)
            .filter((id): id is string => !!id),
        ),
      );
      if (!customerIds.length) return;
      const rows = await this.prisma.customer_companies.findMany({
        where: { tenantId: params.tenantId, id: { in: customerIds } },
        select: { id: true },
      });
      const ok = new Set(rows.map((r: { id: string }) => r.id));
      for (const id of customerIds) {
        if (!ok.has(id)) {
          throw new BadRequestException("Customer is invalid for this tenant");
        }
      }
    });

    await perf.measure("duplicateDetection", async () => {
      const candidatesByKey = await findDuplicateCandidatesForDrafts({
        tx: this.prisma,
        tenantId: params.tenantId,
        drafts: prepared.map((item) => ({
          key: item.draft.id,
          reviewed: item.reviewed,
          requestedPickupDateYmd: requestedPickupDateYmd(item.reviewed),
          duplicateFingerprint: item.fingerprint,
          excludeDraftId: item.draft.id,
        })),
      });
      for (const item of prepared) {
        const candidates = candidatesByKey.get(item.draft.id) ?? [];
        const status = classifyValidationStatus({
          hasBlockingErrors: false,
          duplicateCandidateCount: candidates.length,
          duplicateOverrideAcknowledged: item.overrideAcknowledged,
        });
        if (status !== JobMessageImportDraftValidationStatus.READY) {
          throw new BadRequestException(
            "Possible duplicate requires an explicit override before confirmation",
          );
        }
      }
    });

    const result: ConfirmTxResult = await perf.measure("canonicalTransaction", () =>
      this.prisma.$transaction(
        async (tx: any): Promise<ConfirmTxResult> => {
      const claimed = await tx.jobMessageImportBatch.updateMany({
        where: {
          id: params.batchId,
          tenantId: params.tenantId,
          status: JobMessageImportBatchStatus.IN_REVIEW,
        },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        const current = await tx.jobMessageImportBatch.findFirst({
          where: { id: params.batchId, tenantId: params.tenantId },
          include: { drafts: true },
        });
        if (current?.status === JobMessageImportBatchStatus.CONFIRMED) {
          const confirmedDrafts = current.drafts.filter((d: any) => !!d.canonicalJobId);
          return {
            createdJobIds: confirmedDrafts.map((d: any) => String(d.canonicalJobId)),
            auditEvents: [] as Array<{ jobId: string; draftId: string; clientDraftId: string }>,
            createdForFinalize: [] as Array<{
              jobId: string;
              internalRef: string | null;
              dto: ReturnType<typeof reviewedDraftToCreateJobDto>;
            }>,
          };
        }
        throw new ConflictException({
          code: "BATCH_NOT_CONFIRMABLE",
          message: "Batch cannot be confirmed.",
        });
      }

      const createdJobIds: string[] = [];
      const auditEvents: Array<{ jobId: string; draftId: string; clientDraftId: string }> = [];
      const createdForFinalize: Array<{
        jobId: string;
        internalRef: string | null;
        dto: ReturnType<typeof reviewedDraftToCreateJobDto>;
      }> = [];

      const actorUser = { userId: params.actorUserId };

      for (const item of prepared) {
        const live = await tx.jobMessageImportDraft.findFirst({
          where: {
            id: item.draft.id,
            tenantId: params.tenantId,
            batchId: params.batchId,
          },
        });
        if (!live || live.confirmedAt) {
          throw new BadRequestException("Draft already confirmed");
        }

        const createDto = reviewedDraftToCreateJobDto({
          reviewed: item.reviewed,
          timezone: batch.timezone,
        });
        const createdJob = await perf.measure(
          `canonicalJobCreate:${item.draft.id}`,
          () =>
            this.jobs.createCanonicalJob(params.tenantId, createDto, actorUser, {
              tx,
              perf,
            }),
        );

        await tx.jobMessageImportDraft.update({
          where: { id: item.draft.id },
          data: {
            movementType: item.reviewed.movementType,
            controllerJson: item.reviewed as object,
            duplicateFingerprint: item.fingerprint,
            inclusionState: JobMessageImportDraftInclusionState.INCLUDED,
            confirmedAt: new Date(),
            confirmedByUserId: params.actorUserId,
            canonicalJobId: createdJob.id,
            validationStatus: JobMessageImportDraftValidationStatus.READY,
            duplicateOverrideReason: item.overrideAcknowledged ? item.overrideReason : null,
            duplicateOverrideActorUserId: item.overrideAcknowledged ? params.actorUserId : null,
            duplicateOverrideAt: item.overrideAcknowledged ? new Date() : null,
          },
        });

        createdJobIds.push(createdJob.id);
        createdForFinalize.push({
          jobId: createdJob.id,
          internalRef: createdJob.internalRef,
          dto: createDto,
        });
        auditEvents.push({
          jobId: createdJob.id,
          draftId: item.draft.id,
          clientDraftId: item.draft.clientDraftId,
        });
      }

      await tx.jobMessageImportBatch.update({
        where: { id: params.batchId },
        data: {
          status: JobMessageImportBatchStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedByUserId: params.actorUserId,
        },
      });

      return { createdJobIds, auditEvents, createdForFinalize };
        },
        {
          maxWait: JOB_MESSAGE_IMPORT_CONFIRM_TX_MAX_WAIT_MS,
          timeout: JOB_MESSAGE_IMPORT_CONFIRM_TX_TIMEOUT_MS,
        },
      ),
    );

    const liveDrafts =
      result.createdForFinalize.length > 0
        ? result.auditEvents.map((event) => ({
            id: event.draftId,
            clientDraftId: event.clientDraftId,
            canonicalJobId: event.jobId,
            controllerJson: prepared.find((p) => p.draft.id === event.draftId)?.reviewed ?? null,
          }))
        : (await this.prisma.jobMessageImportBatch.findFirst({
            where: { id: params.batchId, tenantId: params.tenantId },
            include: { drafts: true },
          }))?.drafts?.filter((d: { canonicalJobId?: string | null }) => !!d.canonicalJobId) ?? [];

    const warnings = await this.runPostCommitImportFinalization({
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      batchId: params.batchId,
      timezone: batch.timezone,
      drafts: liveDrafts,
      createdForFinalize: result.createdForFinalize,
      perf,
    });

    perf.flush();
    return {
      createdJobIds: result.createdJobIds,
      createdCount: result.createdJobIds.length,
      warnings,
    };
  }

  private async runPostCommitImportFinalization(params: {
    tenantId: string;
    actorUserId: string | null;
    batchId: string;
    timezone: string;
    drafts: Array<{
      id: string;
      clientDraftId?: string | null;
      canonicalJobId?: string | null;
      controllerJson?: unknown;
    }>;
    createdForFinalize?: Array<{
      jobId: string;
      internalRef: string | null;
      dto: ReturnType<typeof reviewedDraftToCreateJobDto>;
    }>;
    perf: ConfirmPerfTracker;
  }): Promise<JobMessageImportConfirmWarning[]> {
    const warnings: JobMessageImportConfirmWarning[] = [];
    const byCreated = new Map(
      (params.createdForFinalize ?? []).map((row) => [row.jobId, row] as const),
    );
    const targets = params.drafts
      .filter((d) => !!d.canonicalJobId)
      .map((draft) => {
        const jobId = String(draft.canonicalJobId);
        const existing = byCreated.get(jobId);
        const reviewed = readControllerJson(draft.controllerJson);
        return {
          jobId,
          draftId: draft.id,
          clientDraftId: String(draft.clientDraftId ?? draft.id),
          internalRef: existing?.internalRef ?? null,
          dto:
            existing?.dto ??
            reviewedDraftToCreateJobDto({
              reviewed,
              timezone: params.timezone,
            }),
        };
      });

    await mapWithConcurrency(
      targets,
      JOB_MESSAGE_IMPORT_FINALIZE_CONCURRENCY,
      async (created) => {
        try {
          await params.perf.measure(`finalizeCanonicalJobCreate:${created.jobId}`, () =>
            this.jobs.finalizeCanonicalJobCreate(
              params.tenantId,
              created.dto,
              { userId: params.actorUserId },
              { id: created.jobId, internalRef: created.internalRef },
              {
                omitHttpPayload: true,
                tolerateSideEffectFailures: true,
                onSideEffectWarning: (warning) => warnings.push(warning),
                perf: params.perf,
              },
            ),
          );
        } catch (error) {
          console.error(
            `[JobMessageImportService] Post-create finalization failed for job ${created.jobId}:`,
            error && typeof error === "object" && "message" in error
              ? (error as { message?: unknown }).message
              : "unknown error",
          );
          warnings.push({
            code: "POST_CREATE_FINALIZATION_INCOMPLETE",
            jobId: created.jobId,
            operation: "FINALIZE",
          });
        }
      },
    );

    await params.perf.measure("importProvenanceAudit", async () => {
      for (const event of targets) {
        try {
          const alreadyLogged =
            typeof this.prisma.auditLog?.findFirst === "function"
              ? await this.prisma.auditLog.findFirst({
                  where: {
                    tenantId: params.tenantId,
                    entityType: "JOB",
                    entityId: event.jobId,
                    action: "AI_JOB_MESSAGE_IMPORT_CONFIRM",
                  },
                  select: { id: true },
                })
              : null;
          if (alreadyLogged) continue;
          await this.audit.log(
            params.tenantId,
            "AI_JOB_MESSAGE_IMPORT_CONFIRM",
            "JOB",
            event.jobId,
            {
              batchId: params.batchId,
              draftId: event.draftId,
              clientDraftId: event.clientDraftId,
            },
            params.actorUserId,
          );
        } catch (error) {
          console.error(
            `[JobMessageImportService] Import provenance audit failed for job ${event.jobId}:`,
            error && typeof error === "object" && "message" in error
              ? (error as { message?: unknown }).message
              : "unknown error",
          );
          warnings.push({
            code: "POST_CREATE_FINALIZATION_INCOMPLETE",
            jobId: event.jobId,
            operation: "IMPORT_PROVENANCE_AUDIT",
          });
        }
      }
    });

    return warnings;
  }

  private assertProductionParserOutput(parsed: ParseJobMessageResult["message"]): void {
    if (
      (process.env.NODE_ENV ?? "development") === "production" &&
      parsed.parserVersion === FAKE_JOB_MESSAGE_PARSER_VERSION
    ) {
      throw new ServiceUnavailableException(JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE);
    }
  }

  private assertParsedMessageShape(parsed: ParseJobMessageResult["message"]): void {
    if (!parsed || typeof parsed !== "object") {
      throw new BadRequestException("Malformed provider output");
    }
    if (typeof parsed.parserVersion !== "string") {
      throw new BadRequestException("Malformed provider output: parserVersion");
    }
    if (!Array.isArray(parsed.drafts)) {
      throw new BadRequestException("Malformed provider output: drafts");
    }
    for (const d of parsed.drafts) {
      if (!d || typeof d !== "object") {
        throw new BadRequestException("Malformed provider output: draft");
      }
      if (typeof d.clientDraftId !== "string") {
        throw new BadRequestException("Malformed provider output: clientDraftId");
      }
      if (typeof d.sourceFragment !== "string") {
        throw new BadRequestException("Malformed provider output: sourceFragment");
      }
      if (!Array.isArray(d.items)) {
        throw new BadRequestException("Malformed provider output: items");
      }
      if (!Array.isArray(d.warnings)) {
        throw new BadRequestException("Malformed provider output: warnings");
      }
    }
  }

  private async toReviewResponse(
    batchId: string,
    tenantId: string,
  ): Promise<JobMessageImportReviewResponse> {
    const batch = await this.prisma.jobMessageImportBatch.findFirst({
      where: { tenantId, id: batchId },
      include: { drafts: true },
    });
    if (!batch) throw new NotFoundException("Batch not found");

    const drafts: ReviewableJobDraft[] = [];
    for (const d of batch.drafts) {
      const referenceDate = parseReferenceDateForTimezone(batch.timezone);
      const reviewed = sanitizeReviewedDraftForResponse(readControllerJson(d.controllerJson), {
        timezone: batch.timezone,
        referenceDate,
      });
      const parsed = (d.parsedJson ?? {}) as JobMessageImportParsedDraft;
      const validation = validateReviewedDraft(reviewed);
      const candidates: DuplicateCandidate[] = await findDuplicateCandidates({
        tx: this.prisma,
        tenantId,
        requestedPickupDateYmd: requestedPickupDateYmd(reviewed),
        reviewed,
        duplicateFingerprint: d.duplicateFingerprint,
        excludeDraftId: d.id,
        excludeJobIds: d.canonicalJobId ? [d.canonicalJobId] : [],
      });
      const overrideAcknowledged = !!d.duplicateOverrideAt;
      const validationStatus = d.confirmedAt
        ? d.validationStatus
        : classifyValidationStatus({
            hasBlockingErrors: validation.hasBlockingErrors,
            duplicateCandidateCount: candidates.length,
            duplicateOverrideAcknowledged: overrideAcknowledged,
          });

      drafts.push({
        id: d.id,
        draftVersion: d.version,
        clientDraftId: d.clientDraftId,
        inclusionState: d.inclusionState,
        validationStatus,
        reviewed,
        parsed: {
          movementType: parsed.movementType ?? null,
          customerNameText: parsed.customerNameText ?? null,
          pickupRawText: parsed.pickup?.rawText ?? null,
          deliveryRawText: parsed.delivery?.rawText ?? null,
          picName: parsed.picName ?? null,
          picPhone: parsed.picPhone ?? null,
          timingText: parsed.timingText ?? null,
          notes: parsed.notes ?? null,
          instructions: Array.isArray(parsed.instructions) ? parsed.instructions : [],
          carrier: parsed.carrier ?? null,
          shipper: parsed.shipper ?? null,
          vessel: parsed.vessel ?? null,
          voyage: parsed.voyage ?? null,
          items: (parsed.items ?? []).map((it) => ({
            containerNumber: it.containerNumber ?? null,
            sealNumber: it.sealNumber ?? null,
            referenceNumber: it.referenceNumber ?? null,
            quantity: it.quantity ?? null,
          })),
        },
        warnings: validation.warnings,
        fieldErrors: validation.fieldErrors,
        sourceFragment: d.sourceFragment,
        duplicateCandidates: candidates,
        duplicateOverride: {
          acknowledged: overrideAcknowledged,
          reason: d.duplicateOverrideReason ?? null,
          actorUserId: d.duplicateOverrideActorUserId ?? null,
          at: d.duplicateOverrideAt ? d.duplicateOverrideAt.toISOString() : null,
        },
        confirmedAt: d.confirmedAt ? d.confirmedAt.toISOString() : null,
        canonicalJobId: d.canonicalJobId ?? null,
      });
    }

    const included = drafts.filter(
      (d) => d.inclusionState === JobMessageImportDraftInclusionState.INCLUDED,
    );
    const confirmable =
      batch.status === JobMessageImportBatchStatus.IN_REVIEW &&
      included.length > 0 &&
      included.every((d) => d.validationStatus === JobMessageImportDraftValidationStatus.READY);

    return {
      batchId: batch.id,
      status: batch.status,
      version: batch.version,
      timezone: batch.timezone,
      parserVersion: batch.parserVersion,
      modelName: batch.modelName,
      confirmable,
      drafts,
      summary: {
        extracted: drafts.length,
        ready: drafts.filter((x) => x.validationStatus === "READY").length,
        needsReview: drafts.filter((x) => x.validationStatus === "NEEDS_REVIEW").length,
        possibleDuplicates: drafts.filter((x) => x.validationStatus === "POSSIBLE_DUPLICATE").length,
        included: included.length,
        excluded: drafts.length - included.length,
      },
    };
  }
}
