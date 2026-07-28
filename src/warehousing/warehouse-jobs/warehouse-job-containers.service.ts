import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateWarehouseJobContainerDto } from './dto/create-warehouse-job-container.dto';

export type NormalizedWarehouseJobContainer = {
  containerNumber: string | null;
  sealNumber: string | null;
  notes: string | null;
  sortOrder: number;
};

@Injectable()
export class WarehouseJobContainersService {
  normalize(
    containers: CreateWarehouseJobContainerDto[] | undefined,
  ): NormalizedWarehouseJobContainer[] {
    if (!containers?.length) return [];

    return containers
      .map((dto, index) => ({
        containerNumber: dto.containerNumber?.trim() || null,
        sealNumber: dto.sealNumber?.trim() || null,
        notes: dto.notes?.trim() || null,
        sortOrder: dto.sortOrder ?? index,
      }))
      .filter(
        (row) =>
          Boolean(row.containerNumber) ||
          Boolean(row.sealNumber) ||
          Boolean(row.notes),
      )
      .map((row, index) => ({
        ...row,
        sortOrder: row.sortOrder ?? index,
      }));
  }

  /** Keep legacy single-container columns in sync with the first row. */
  legacyFieldsFromContainers(containers: NormalizedWarehouseJobContainer[]) {
    const first = containers[0];
    return {
      containerNumber: first?.containerNumber ?? null,
      sealNumber: first?.sealNumber ?? null,
      warehouseNotes: first?.notes ?? null,
    };
  }

  async createManyInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseJobId: string,
    containers: NormalizedWarehouseJobContainer[],
  ) {
    if (!containers.length) return [];

    const created = [];
    for (const [index, row] of containers.entries()) {
      const item = await tx.warehouseJobContainer.create({
        data: {
          tenantId,
          warehouseJobId,
          containerNumber: row.containerNumber,
          sealNumber: row.sealNumber,
          notes: row.notes,
          sortOrder: row.sortOrder ?? index,
        },
      });
      created.push(item);
    }
    return created;
  }

  async replaceAllInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseJobId: string,
    containers: NormalizedWarehouseJobContainer[],
  ) {
    await tx.warehouseJobContainer.deleteMany({
      where: { tenantId, warehouseJobId },
    });
    return this.createManyInTransaction(
      tx,
      tenantId,
      warehouseJobId,
      containers,
    );
  }
}
