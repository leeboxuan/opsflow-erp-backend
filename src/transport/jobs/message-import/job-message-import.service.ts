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
  JobType,
} from "@prisma/client";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { AuditService } from "../../../shared/audit/audit.service";
import {
  JobMessageParser,
  type JobMessageImportParsedDraft,
  type ParseJobMessageResult,
} from "./job-message-parser";
import {
  JOB_MESSAGE_IMPORT_MAX_INPUT_CHARS,
  JOB_MESSAGE_PARSER_TOKEN,
  FAKE_JOB_MESSAGE_PARSER_VERSION,
} from "./job-message-import.constants";
import { assertSourceFragmentsTraceable } from "./job-message-import.source-fidelity";
import { JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE } from "./job-message-parser.factory";
import {
  computeBatchFingerprint,
  computeDraftFingerprint,
} from "./job-message-import.fingerprint";
import { findDuplicateCandidates } from "./job-message-import.duplicates";
import { reviewedDraftToCanonicalJobCreate } from "./job-message-import.mapping";
import {
  classifyValidationStatus,
  normalizeReviewedDraft,
  validateReviewedDraft,
} from "./job-message-import.validator";
import { parseOperationalTiming } from "./job-message-import.timing";
import {
  parseReferenceDateForTimezone,
  requestedPickupDateYmd,
} from "./job-message-import.planning-date";
import { normalizeLocationLabel } from "./job-message-import.text-normalize";
import type {
  ControllerReviewedDraft,
  DuplicateCandidate,
  JobMessageImportReviewResponse,
  ReviewableJobDraft,
} from "./job-message-import.types";

export type JobMessageImportConfirmDraftSelection = {
  draftId: string;
  expectedDraftVersion: number;
  inclusionState?: JobMessageImportDraftInclusionState;
};

export type PatchDraftInput = {
  expectedDraftVersion: number;
  movementType?: ControllerReviewedDraft["movementType"];
  collectionType?: ControllerReviewedDraft["collectionType"];
  customerCompanyId?: string | null;
  customerNameText?: string | null;
  pickupAddress1?: string | null;
  pickupAddress2?: string | null;
  pickupPostal?: string | null;
  pickupPlaceId?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  deliveryAddress1?: string | null;
  deliveryAddress2?: string | null;
  deliveryPostal?: string | null;
  deliveryPlaceId?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  pickupDateLocal?: string | null;
  deliveryDateLocal?: string | null;
  pickupDateDisplay?: string | null;
  deliveryDateDisplay?: string | null;
  pickupDateNeedsReview?: boolean;
  deliveryDateNeedsReview?: boolean;
  picName?: string | null;
  picPhone?: string | null;
  notes?: string | null;
  instructions?: string[];
  timingText?: string | null;
  carrierName?: string | null;
  shipper?: string | null;
  vesselName?: string | null;
  voyage?: string | null;
  items?: Array<{
    containerNumber?: string | null;
    sealNumber?: string | null;
    referenceNumber?: string | null;
    quantity?: number | null;
  }>;
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
  let timing = parseOperationalTiming({
    text: parsed.timingText,
    referenceDate,
    timezone,
  });
  if (!parsed.timingText) {
    const fromFragment = parseOperationalTiming({
      text: parsed.sourceFragment,
      referenceDate,
      timezone,
    });
    if (fromFragment.pickupDateLocal && !fromFragment.needsReview) {
      timing = fromFragment;
    }
  }
  const pickupRaw = parsed.pickup?.rawText ?? null;
  const pickupAddress1 =
    normalizeLocationLabel(pickupRaw) ||
    (timing.locationHint ? normalizeLocationLabel(timing.locationHint) : null);
  return normalizeReviewedDraft({
    movementType: mapParsedMovementType(parsed.movementType),
    collectionType: null,
    customerCompanyId,
    customerNameText: parsed.customerNameText ?? null,
    pickupAddress1,
    pickupAddress2: null,
    pickupPostal: null,
    pickupPlaceId: null,
    pickupLat: null,
    pickupLng: null,
    deliveryAddress1: parsed.delivery?.rawText ?? null,
    deliveryAddress2: null,
    deliveryPostal: null,
    deliveryPlaceId: null,
    deliveryLat: null,
    deliveryLng: null,
    pickupDateLocal: timing.pickupDateLocal,
    deliveryDateLocal: timing.deliveryDateLocal,
    pickupDateDisplay: timing.display,
    deliveryDateDisplay: null,
    pickupDateNeedsReview: timing.needsReview,
    deliveryDateNeedsReview: false,
    picName: parsed.picName ?? null,
    picPhone: parsed.picPhone ?? null,
    notes: parsed.notes ?? null,
    instructions: Array.isArray(parsed.instructions) ? parsed.instructions : [],
    timingText: parsed.timingText ?? null,
    carrierName: parsed.carrier ?? null,
    shipper: parsed.shipper ?? null,
    vesselName: parsed.vessel ?? null,
    voyage: parsed.voyage ?? null,
    items: (parsed.items ?? []).map((it) => ({
      containerNumber: it.containerNumber ?? null,
      sealNumber: it.sealNumber ?? null,
      referenceNumber: it.referenceNumber ?? null,
      quantity: it.quantity ?? null,
    })),
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
    items: c.items ?? [],
  });
}

function isUniqueConflict(e: any): boolean {
  return e?.code === "P2002";
}

function mapParserError(e: any): never {
  const code = e?.code ? String(e.code) : "";
  if (code === "PARSER_CONFIGURATION") {
    throw new ServiceUnavailableException(JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE);
  }
  if (code === "INPUT_TOO_LARGE") {
    throw new BadRequestException("sourceText is too large");
  }
  if (code === "OPENAI_REFUSAL") {
    throw new BadRequestException("AI refused to parse this job message");
  }
  if (code === "OPENAI_TIMEOUT") {
    throw new BadRequestException("AI provider timed out");
  }
  if (code === "OPENAI_INVALID_OUTPUT") {
    throw new BadRequestException("Malformed provider output");
  }
  throw new BadRequestException("AI provider failure");
}

@Injectable()
export class JobMessageImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(JOB_MESSAGE_PARSER_TOKEN) private readonly parser: JobMessageParser,
  ) {}

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

    const draftsToCreate = [];
    for (const d of parsed.drafts) {
      const customerId = d.customerNameText
        ? customerByName.get(d.customerNameText) ?? null
        : null;
      const reviewed = controllerJsonFromParsed(d, customerId, {
        timezone: params.timezone,
        referenceDate,
      });
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
    const nextReviewed = normalizeReviewedDraft({
      ...current,
      ...(params.patch.movementType != null
        ? { movementType: params.patch.movementType }
        : {}),
      ...(params.patch.collectionType !== undefined
        ? { collectionType: params.patch.collectionType }
        : {}),
      ...(params.patch.customerCompanyId !== undefined
        ? { customerCompanyId: params.patch.customerCompanyId }
        : {}),
      ...(params.patch.customerNameText !== undefined
        ? { customerNameText: params.patch.customerNameText }
        : {}),
      ...(params.patch.pickupAddress1 !== undefined
        ? { pickupAddress1: params.patch.pickupAddress1 }
        : {}),
      ...(params.patch.pickupAddress2 !== undefined
        ? { pickupAddress2: params.patch.pickupAddress2 }
        : {}),
      ...(params.patch.pickupPostal !== undefined
        ? { pickupPostal: params.patch.pickupPostal }
        : {}),
      ...(params.patch.pickupPlaceId !== undefined
        ? { pickupPlaceId: params.patch.pickupPlaceId }
        : {}),
      ...(params.patch.pickupLat !== undefined ? { pickupLat: params.patch.pickupLat } : {}),
      ...(params.patch.pickupLng !== undefined ? { pickupLng: params.patch.pickupLng } : {}),
      ...(params.patch.deliveryAddress1 !== undefined
        ? { deliveryAddress1: params.patch.deliveryAddress1 }
        : {}),
      ...(params.patch.deliveryAddress2 !== undefined
        ? { deliveryAddress2: params.patch.deliveryAddress2 }
        : {}),
      ...(params.patch.deliveryPostal !== undefined
        ? { deliveryPostal: params.patch.deliveryPostal }
        : {}),
      ...(params.patch.deliveryPlaceId !== undefined
        ? { deliveryPlaceId: params.patch.deliveryPlaceId }
        : {}),
      ...(params.patch.deliveryLat !== undefined
        ? { deliveryLat: params.patch.deliveryLat }
        : {}),
      ...(params.patch.deliveryLng !== undefined
        ? { deliveryLng: params.patch.deliveryLng }
        : {}),
      ...(params.patch.pickupDateLocal !== undefined
        ? { pickupDateLocal: params.patch.pickupDateLocal }
        : {}),
      ...(params.patch.deliveryDateLocal !== undefined
        ? { deliveryDateLocal: params.patch.deliveryDateLocal }
        : {}),
      ...(params.patch.pickupDateDisplay !== undefined
        ? { pickupDateDisplay: params.patch.pickupDateDisplay }
        : {}),
      ...(params.patch.deliveryDateDisplay !== undefined
        ? { deliveryDateDisplay: params.patch.deliveryDateDisplay }
        : {}),
      ...(params.patch.pickupDateNeedsReview !== undefined
        ? { pickupDateNeedsReview: params.patch.pickupDateNeedsReview }
        : {}),
      ...(params.patch.deliveryDateNeedsReview !== undefined
        ? { deliveryDateNeedsReview: params.patch.deliveryDateNeedsReview }
        : {}),
      ...(params.patch.picName !== undefined ? { picName: params.patch.picName } : {}),
      ...(params.patch.picPhone !== undefined ? { picPhone: params.patch.picPhone } : {}),
      ...(params.patch.notes !== undefined ? { notes: params.patch.notes } : {}),
      ...(params.patch.instructions !== undefined
        ? { instructions: params.patch.instructions }
        : {}),
      ...(params.patch.timingText !== undefined
        ? { timingText: params.patch.timingText }
        : {}),
      ...(params.patch.carrierName !== undefined
        ? { carrierName: params.patch.carrierName }
        : {}),
      ...(params.patch.shipper !== undefined ? { shipper: params.patch.shipper } : {}),
      ...(params.patch.vesselName !== undefined
        ? { vesselName: params.patch.vesselName }
        : {}),
      ...(params.patch.voyage !== undefined ? { voyage: params.patch.voyage } : {}),
      ...(params.patch.items !== undefined ? { items: params.patch.items } : {}),
    });

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
    expectedBatchVersion: number;
    selection: JobMessageImportConfirmDraftSelection[];
  }): Promise<{ createdJobIds: string[]; createdCount: number }> {
    const batch = await this.prisma.jobMessageImportBatch.findFirst({
      where: { tenantId: params.tenantId, id: params.batchId },
      include: { drafts: true },
    });
    if (!batch) throw new NotFoundException("Batch not found");

    if (batch.status === JobMessageImportBatchStatus.CONFIRMED) {
      const confirmedDrafts = batch.drafts.filter((d) => !!d.canonicalJobId);
      return {
        createdJobIds: confirmedDrafts.map((d) => String(d.canonicalJobId)),
        createdCount: confirmedDrafts.length,
      };
    }
    if (batch.status !== JobMessageImportBatchStatus.IN_REVIEW) {
      throw new BadRequestException("Batch cannot be confirmed");
    }
    if (batch.version !== params.expectedBatchVersion) {
      throw new ConflictException({
        code: "STALE_VERSION",
        message: "Batch version is stale; please refresh.",
        currentVersion: batch.version,
      });
    }

    const included = batch.drafts.filter(
      (d) => d.inclusionState === JobMessageImportDraftInclusionState.INCLUDED,
    );
    if (!included.length) {
      throw new BadRequestException("No included drafts to confirm");
    }

    const selectionById = new Map(params.selection.map((s) => [s.draftId, s]));
    for (const d of included) {
      const sel = selectionById.get(d.id);
      if (!sel) {
        throw new ConflictException({
          code: "STALE_SELECTION",
          message: "Included draft missing from confirmation payload; please refresh.",
        });
      }
      if (d.version !== sel.expectedDraftVersion) {
        throw new ConflictException({
          code: "STALE_VERSION",
          message: "Draft version is stale; please refresh.",
          draftId: d.id,
          currentVersion: d.version,
        });
      }
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      const claimed = await tx.jobMessageImportBatch.updateMany({
        where: {
          id: params.batchId,
          tenantId: params.tenantId,
          status: JobMessageImportBatchStatus.IN_REVIEW,
          version: params.expectedBatchVersion,
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
          };
        }
        throw new ConflictException({
          code: "STALE_VERSION",
          message: "Batch version is stale; please refresh.",
        });
      }

      const drafts = await tx.jobMessageImportDraft.findMany({
        where: { tenantId: params.tenantId, batchId: params.batchId },
      });
      const includedNow = drafts.filter(
        (d: any) => d.inclusionState === JobMessageImportDraftInclusionState.INCLUDED,
      );
      const createdJobIds: string[] = [];
      const auditEvents: Array<{ jobId: string; draftId: string; clientDraftId: string }> = [];

      for (const d of includedNow) {
        if (d.confirmedAt) {
          throw new BadRequestException("Draft already confirmed");
        }
        const reviewed = readControllerJson(d.controllerJson);
        const validation = validateReviewedDraft(reviewed);
        const candidates = await findDuplicateCandidates({
          tx,
          tenantId: params.tenantId,
          requestedPickupDateYmd: requestedPickupDateYmd(reviewed),
          reviewed,
          duplicateFingerprint: d.duplicateFingerprint,
          excludeDraftId: d.id,
        });
        const overrideAcknowledged = !!d.duplicateOverrideAt;
        const status = classifyValidationStatus({
          hasBlockingErrors: validation.hasBlockingErrors,
          duplicateCandidateCount: candidates.length,
          duplicateOverrideAcknowledged: overrideAcknowledged,
        });
        if (status !== JobMessageImportDraftValidationStatus.READY) {
          throw new BadRequestException(
            status === JobMessageImportDraftValidationStatus.POSSIBLE_DUPLICATE
              ? "Possible duplicate requires an explicit override before confirmation"
              : "Included drafts have unresolved validation errors",
          );
        }
        if (reviewed.customerCompanyId) {
          const exists = await tx.customer_companies.findFirst({
            where: { tenantId: params.tenantId, id: reviewed.customerCompanyId },
            select: { id: true },
          });
          if (!exists) {
            throw new BadRequestException("Customer is invalid for this tenant");
          }
        }

        const canonical = reviewedDraftToCanonicalJobCreate({
          reviewed,
          timezone: batch.timezone,
        });
        const internalRef = await this.getNextInternalRef(tx, params.tenantId, canonical.jobType);
        const createdJob = await tx.job.create({
          data: {
            tenantId: params.tenantId,
            customerCompanyId: canonical.customerCompanyId,
            internalRef,
            externalRef: null,
            jobType: canonical.jobType,
            collectionType: canonical.collectionType,
            status: canonical.status,
            createdByUserId: params.actorUserId,
            pickupDate: canonical.pickupDate,
            pickupAddress1: canonical.pickupAddress1,
            pickupAddress2: canonical.pickupAddress2,
            pickupPostal: canonical.pickupPostal,
            pickupContactName: canonical.pickupContactName,
            pickupContactPhone: canonical.pickupContactPhone,
            deliveryAddress1: canonical.deliveryAddress1,
            deliveryAddress2: canonical.deliveryAddress2,
            deliveryPostal: canonical.deliveryPostal,
            receiverName: canonical.receiverName,
            receiverPhone: canonical.receiverPhone,
            description: canonical.description,
            notes: canonical.notes,
            carrierName: canonical.carrierName,
            shipper: canonical.shipper,
            vesselName: canonical.vesselName,
            voyage: canonical.voyage,
            items: {
              create: canonical.items.map((it) => ({
                tenantId: params.tenantId,
                itemCode: it.itemCode,
                description: it.description,
                sealNo: it.sealNo,
                pickupReference: it.pickupReference,
                qty: it.qty,
              })),
            },
          },
        });

        await tx.jobMessageImportDraft.update({
          where: { id: d.id },
          data: {
            confirmedAt: new Date(),
            confirmedByUserId: params.actorUserId,
            canonicalJobId: createdJob.id,
            validationStatus: JobMessageImportDraftValidationStatus.READY,
          },
        });

        createdJobIds.push(createdJob.id);
        auditEvents.push({
          jobId: createdJob.id,
          draftId: d.id,
          clientDraftId: d.clientDraftId,
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

      return { createdJobIds, auditEvents };
    });

    for (const event of result.auditEvents) {
      await this.audit.log(
        params.tenantId,
        "AI_JOB_MESSAGE_IMPORT_CONFIRM",
        "JOB",
        event.jobId,
        { batchId: params.batchId, draftId: event.draftId, clientDraftId: event.clientDraftId },
        params.actorUserId,
      );
    }

    return { createdJobIds: result.createdJobIds, createdCount: result.createdJobIds.length };
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
      const reviewed = readControllerJson(d.controllerJson);
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

  private async getNextInternalRef(
    tx: any,
    tenantId: string,
    jobType: JobType,
  ): Promise<string> {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = now.getUTCMonth() + 1;
    const MM = String(mm).padStart(2, "0");
    const yyyymm = `${yyyy}-${MM}`;
    const row = await tx.job_internal_ref_counters.upsert({
      where: { tenantId_yyyymm: { tenantId, yyyymm } },
      create: { tenantId, yyyymm, nextSeq: 1 },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });
    const seq = String(row.nextSeq).padStart(4, "0");
    const typeCode = (() => {
      switch (jobType) {
        case JobType.LCL:
          return "LCL";
        case JobType.IMPORT:
          return "IMP";
        case JobType.EXPORT:
          return "EXP";
        case JobType.COLLECTION:
          return "COL";
        default:
          return "GEN";
      }
    })();
    return `WFL-${yyyy}-${MM}-${seq}-${typeCode}`;
  }
}
