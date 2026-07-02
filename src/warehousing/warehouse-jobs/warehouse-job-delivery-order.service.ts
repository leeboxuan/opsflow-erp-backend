import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  WarehouseJobDocumentReviewStatus,
  WarehouseJobDocumentSource,
  WarehouseJobDocumentType,
  WarehouseJobEventType,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SupabaseService } from '../../shared/auth/supabase.service';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import {
  buildWarehouseJobDocumentStorageKey,
  uploadWarehouseJobDocumentBuffer,
} from './warehouse-job-document-storage';
import { buildWarehouseDeliveryOrderPdf } from './warehouse-job-delivery-order-pdf';
import { warehouseJobDetailInclude } from './warehouse-job-lifecycle.service';

@Injectable()
export class WarehouseJobDeliveryOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly eventsService: WarehouseJobEventsService,
  ) {}

  async generate(
    tenantId: string,
    warehouseJobId: string,
    actorUserId?: string,
    actorRole: Role = Role.OPS,
  ) {
    const job = await this.prisma.warehouseJob.findFirst({
      where: { id: warehouseJobId, tenantId },
      include: warehouseJobDetailInclude,
    });

    if (!job) {
      throw new NotFoundException('Warehouse job not found');
    }

    if (job.deliveryOrderDocumentId) {
      throw new BadRequestException(
        'Delivery order already generated for this warehouse job',
      );
    }

    const pdfBytes = buildWarehouseDeliveryOrderPdf(job);
    const fileName = `delivery-order-${job.internalRef}.pdf`;
    const storageKey = buildWarehouseJobDocumentStorageKey(
      tenantId,
      warehouseJobId,
      WarehouseJobDocumentType.DELIVERY_ORDER,
      fileName,
    );

    await uploadWarehouseJobDocumentBuffer(
      this.supabaseService,
      storageKey,
      pdfBytes,
      'application/pdf',
    );

    const source =
      actorRole === Role.ADMIN
        ? WarehouseJobDocumentSource.ADMIN
        : WarehouseJobDocumentSource.OPS;

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.warehouseJobDocument.create({
        data: {
          tenantId,
          warehouseJobId,
          uploadedByUserId: actorUserId ?? null,
          type: WarehouseJobDocumentType.DELIVERY_ORDER,
          source,
          reviewStatus: WarehouseJobDocumentReviewStatus.PENDING_REVIEW,
          originalName: fileName,
          fileName,
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          storageKey,
          notes: 'Generated delivery order / manifest',
        },
      });

      const updated = await tx.warehouseJob.update({
        where: { id: job.id },
        data: {
          deliveryOrderDocumentId: document.id,
          deliveryOrderGeneratedAt: new Date(),
          generateDeliveryOrder: true,
        },
        include: warehouseJobDetailInclude,
      });

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.DOCUMENT_UPLOADED,
        payload: {
          documentId: document.id,
          type: WarehouseJobDocumentType.DELIVERY_ORDER,
          generated: true,
        },
      });

      return { job: updated, document };
    });
  }
}
