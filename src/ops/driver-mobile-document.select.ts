import { JobDocumentType, Prisma } from "@prisma/client";
import { documentUploadedByInclude } from "../transport/documents/document-uploader.utils";

/** Slim JobDocument fields for driver mobile list/home (no signed URLs). */
export const JOB_DOCUMENT_MOBILE_SELECT = {
  id: true,
  type: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  storageKey: true,
  isActive: true,
  jobId: true,
  uploadedByUserId: true,
  uploadedByNameSnapshot: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: documentUploadedByInclude.uploadedBy,
} satisfies Prisma.JobDocumentSelect;

/** Slim TripDocument fields for driver mobile trip flows (signature fields valid on TripDocument). */
export const TRIP_DOCUMENT_MOBILE_SELECT = {
  id: true,
  type: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  storageKey: true,
  isActive: true,
  tripId: true,
  uploadedByUserId: true,
  uploadedByNameSnapshot: true,
  generatedBySystem: true,
  generatedSource: true,
  requiresSignature: true,
  isSigned: true,
  signedAt: true,
  signedByUserId: true,
  signedByName: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: documentUploadedByInclude.uploadedBy,
} satisfies Prisma.TripDocumentSelect;

export const DRIVER_ACTIVE_JOB_DOCUMENTS_INCLUDE = {
  where: {
    isActive: true,
    type: { in: [JobDocumentType.QUOTATION, JobDocumentType.OTHER] },
  },
  orderBy: { createdAt: "desc" as const },
  select: JOB_DOCUMENT_MOBILE_SELECT,
};
