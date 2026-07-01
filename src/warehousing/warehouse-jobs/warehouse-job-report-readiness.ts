import {
  WarehouseJobDocumentReviewStatus,
  WarehouseJobDocumentType,
  WarehouseJobStatus,
} from '@prisma/client';

export type ReportPreviewBlocker = {
  code: string;
  message: string;
};

export type WarehouseJobReadinessInput = {
  status: WarehouseJobStatus;
  containerNumber: string | null | undefined;
  sealNumber: string | null | undefined;
  warehouseNotes: string | null | undefined;
  documents: Array<{
    type: WarehouseJobDocumentType;
    reviewStatus: WarehouseJobDocumentReviewStatus;
  }>;
};

export type WarehouseJobReadiness = {
  hasPackingList: boolean;
  hasDeliveryOrder: boolean;
  hasInstruction: boolean;
  hasWarehousePhoto: boolean;
  hasCompletionPhoto: boolean;
  hasDamagePhoto: boolean;
  totalDocuments: number;
  pendingReviewDocuments: number;
  approvedDocuments: number;
  rejectedDocuments: number;
  allDocumentsReviewed: boolean;
  hasRejectedDocuments: boolean;
  hasContainerNumber: boolean;
  hasWarehouseNotes: boolean;
  hasExecutionDetails: boolean;
  jobCompleted: boolean;
  readyForReport: boolean;
  blockers: ReportPreviewBlocker[];
};

function hasNonRejectedType(
  documents: WarehouseJobReadinessInput['documents'],
  type: WarehouseJobDocumentType,
): boolean {
  return documents.some(
    (doc) =>
      doc.type === type &&
      doc.reviewStatus !== WarehouseJobDocumentReviewStatus.REJECTED,
  );
}

function countByReviewStatus(
  documents: WarehouseJobReadinessInput['documents'],
  status: WarehouseJobDocumentReviewStatus,
): number {
  return documents.filter((doc) => doc.reviewStatus === status).length;
}

export function computeWarehouseJobReadiness(
  input: WarehouseJobReadinessInput,
): WarehouseJobReadiness {
  const { status, containerNumber, sealNumber, warehouseNotes, documents } =
    input;

  const totalDocuments = documents.length;
  const pendingReviewDocuments = countByReviewStatus(
    documents,
    WarehouseJobDocumentReviewStatus.PENDING_REVIEW,
  );
  const approvedDocuments = countByReviewStatus(
    documents,
    WarehouseJobDocumentReviewStatus.APPROVED,
  );
  const rejectedDocuments = countByReviewStatus(
    documents,
    WarehouseJobDocumentReviewStatus.REJECTED,
  );

  const hasContainerNumber = Boolean(containerNumber?.trim());
  const hasWarehouseNotes = Boolean(warehouseNotes?.trim());
  const hasSealNumber = Boolean(sealNumber?.trim());
  const hasExecutionDetails =
    hasContainerNumber || hasWarehouseNotes || hasSealNumber;

  const hasPackingList = hasNonRejectedType(
    documents,
    WarehouseJobDocumentType.PACKING_LIST,
  );
  const hasDeliveryOrder = hasNonRejectedType(
    documents,
    WarehouseJobDocumentType.DELIVERY_ORDER,
  );
  const hasInstruction = hasNonRejectedType(
    documents,
    WarehouseJobDocumentType.INSTRUCTION,
  );
  const hasWarehousePhoto = hasNonRejectedType(
    documents,
    WarehouseJobDocumentType.WAREHOUSE_PHOTO,
  );
  const hasCompletionPhoto = hasNonRejectedType(
    documents,
    WarehouseJobDocumentType.COMPLETION_PHOTO,
  );
  const hasDamagePhoto = hasNonRejectedType(
    documents,
    WarehouseJobDocumentType.DAMAGE_PHOTO,
  );

  const allDocumentsReviewed =
    totalDocuments > 0 && pendingReviewDocuments === 0;
  const hasRejectedDocuments = rejectedDocuments > 0;
  const jobCompleted = status === WarehouseJobStatus.COMPLETED;

  const blockers: ReportPreviewBlocker[] = [];

  if (!jobCompleted) {
    blockers.push({
      code: 'JOB_NOT_COMPLETED',
      message: 'Warehouse job is not completed.',
    });
  }
  if (totalDocuments === 0) {
    blockers.push({
      code: 'NO_DOCUMENTS',
      message: 'No documents have been uploaded.',
    });
  }
  if (pendingReviewDocuments > 0) {
    blockers.push({
      code: 'PENDING_DOCUMENT_REVIEW',
      message: 'Some documents are still pending review.',
    });
  }
  if (hasRejectedDocuments) {
    blockers.push({
      code: 'REJECTED_DOCUMENTS',
      message: 'Some documents were rejected.',
    });
  }
  if (!hasExecutionDetails) {
    blockers.push({
      code: 'MISSING_EXECUTION_DETAILS',
      message:
        'Container number, seal number, or warehouse notes are required.',
    });
  }
  if (!hasWarehousePhoto && !hasCompletionPhoto) {
    blockers.push({
      code: 'MISSING_WAREHOUSE_OR_COMPLETION_PHOTO',
      message: 'At least one warehouse or completion photo is required.',
    });
  }

  const readyForReport =
    jobCompleted &&
    totalDocuments > 0 &&
    pendingReviewDocuments === 0 &&
    rejectedDocuments === 0 &&
    hasExecutionDetails &&
    (hasWarehousePhoto || hasCompletionPhoto);

  return {
    hasPackingList,
    hasDeliveryOrder,
    hasInstruction,
    hasWarehousePhoto,
    hasCompletionPhoto,
    hasDamagePhoto,
    totalDocuments,
    pendingReviewDocuments,
    approvedDocuments,
    rejectedDocuments,
    allDocumentsReviewed,
    hasRejectedDocuments,
    hasContainerNumber,
    hasWarehouseNotes,
    hasExecutionDetails,
    jobCompleted,
    readyForReport,
    blockers,
  };
}

export function computeWarehouseJobProgress(
  lines: Array<{ requestedQty: number; completedQty: number }>,
  units: Array<{ linkStatus: string }>,
): {
  lineCount: number;
  completedLineCount: number;
  requestedQtyTotal: number;
  completedQtyTotal: number;
  progressPercent: number;
  unitCount: number;
  confirmedUnitCount: number;
} {
  const lineCount = lines.length;
  const completedLineCount = lines.filter(
    (line) => line.requestedQty > 0 && line.completedQty >= line.requestedQty,
  ).length;
  const requestedQtyTotal = lines.reduce(
    (sum, line) => sum + line.requestedQty,
    0,
  );
  const completedQtyTotal = lines.reduce(
    (sum, line) => sum + line.completedQty,
    0,
  );
  const progressPercent =
    requestedQtyTotal > 0
      ? Math.round((completedQtyTotal / requestedQtyTotal) * 100)
      : 0;
  const unitCount = units.length;
  const confirmedUnitCount = units.filter(
    (unit) => unit.linkStatus === 'CONFIRMED',
  ).length;

  return {
    lineCount,
    completedLineCount,
    requestedQtyTotal,
    completedQtyTotal,
    progressPercent,
    unitCount,
    confirmedUnitCount,
  };
}
