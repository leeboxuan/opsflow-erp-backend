import type {
  JobMessageImportDraftInclusionState,
  JobMessageImportDraftValidationStatus,
  JobMessageImportMovementType,
} from "@prisma/client";
import type { JobMessageImportParseWarning } from "./job-message-parser";

export type ControllerReviewedItem = {
  containerNumber: string | null;
  sealNumber: string | null;
  referenceNumber: string | null;
  quantity: number | null;
};

/**
 * Authoritative controller-reviewed draft used for validation, duplicates, and confirm.
 * `parsedJson` is never written from this shape.
 */
export type ControllerReviewedDraft = {
  movementType: JobMessageImportMovementType;
  collectionType: "EMPTY" | "LOADED" | null;
  customerCompanyId: string | null;
  customerNameText: string | null;
  pickupAddress1: string | null;
  deliveryAddress1: string | null;
  picName: string | null;
  picPhone: string | null;
  notes: string | null;
  instructions: string[];
  timingText: string | null;
  carrierName: string | null;
  shipper: string | null;
  vesselName: string | null;
  voyage: string | null;
  items: ControllerReviewedItem[];
};

export type DuplicateCandidate = {
  jobId: string;
  internalRef: string;
  jobType: string;
  status: string;
  pickupDate: string | null;
  customerCompanyId: string | null;
  customerName: string | null;
  itemCodes: string[];
};

export type JobMessageImportFieldError = {
  field: string;
  code: string;
  message: string;
};

export type ReviewableJobDraft = {
  id: string;
  draftVersion: number;
  clientDraftId: string;
  inclusionState: JobMessageImportDraftInclusionState;
  validationStatus: JobMessageImportDraftValidationStatus;
  reviewed: ControllerReviewedDraft;
  parsed: {
    movementType: string | null;
    customerNameText: string | null;
    pickupRawText: string | null;
    deliveryRawText: string | null;
    picName: string | null;
    picPhone: string | null;
    timingText: string | null;
    notes: string | null;
    instructions: string[];
    carrier: string | null;
    shipper: string | null;
    vessel: string | null;
    voyage: string | null;
    items: ControllerReviewedItem[];
  };
  warnings: JobMessageImportParseWarning[];
  fieldErrors: JobMessageImportFieldError[];
  sourceFragment: string;
  duplicateCandidates: DuplicateCandidate[];
  duplicateOverride: {
    acknowledged: boolean;
    reason: string | null;
    actorUserId: string | null;
    at: string | null;
  };
  confirmedAt: string | null;
  canonicalJobId: string | null;
};

export type JobMessageImportReviewResponse = {
  batchId: string;
  status: string;
  version: number;
  serviceDate: string;
  timezone: string;
  parserVersion: string;
  modelName: string | null;
  confirmable: boolean;
  drafts: ReviewableJobDraft[];
  summary: {
    extracted: number;
    ready: number;
    needsReview: number;
    possibleDuplicates: number;
    included: number;
    excluded: number;
  };
};

export type JobMessageParseMeta = {
  modelName: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  providerRequestId: string | null;
};
