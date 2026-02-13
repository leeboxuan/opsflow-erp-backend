import { OrderStatus, StopType, PodStatus } from '@prisma/client';

export interface StopDto {
  id: string;
  sequence: number;
  type: StopType;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postalCode: string;
  country: string;
  plannedAt: Date | null;
  transportOrderId: string | null;
  createdAt: Date;
  updatedAt: Date;
  pod?: PodDto | null;
}

export interface PodDto {
  id: string;
  status: PodStatus;
  signedBy: string | null;
  signedAt: Date | null;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderDto {
  id: string;
  orderRef: string;
  customerRef: string;
  customerName: string | null;

  // ✅ NEW
  customerContactNumber: string | null;

  status: OrderStatus;
  pickupWindowStart: Date | null;
  pickupWindowEnd: Date | null;
  deliveryWindowStart: Date | null;
  deliveryWindowEnd: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  stops?: StopDto[];
  items?: Array<{
    id: string;
    tenantId: string;
    transportOrderId: string;
    inventoryItemId: string;
    batchId: string | null;
    qty: number;
    sku: string | null;
    name: string | null;
    unitSkus?: string[];

    createdAt: Date;
    updatedAt: Date;

  }>;
  // Internal OpsFlow ref
  internalRef?: string | null;

  // Signed Delivery Order fields
  doDocumentUrl?: string | null;
  doSignatureUrl?: string | null;
  doSignerName?: string | null;
  doSignedAt?: Date | null;
  doStatus?: string | null;

  // Versioning for DO changes
  doVersion?: number | null;
}
