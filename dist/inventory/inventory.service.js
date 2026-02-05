"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
let InventoryService = class InventoryService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async updateAvailableQty(tenantId, inventoryItemId, tx) {
        const prisma = tx || this.prisma;
        const count = await prisma.inventory_units.count({
            where: {
                tenantId,
                inventoryItemId,
                status: client_1.InventoryUnitStatus.Available,
            },
        });
        await prisma.inventory_items.update({
            where: { id: inventoryItemId },
            data: { availableQty: count },
        });
    }
    async getItemsSummary(tenantId, search) {
        const where = { tenantId };
        if (search) {
            where.OR = [
                { sku: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { reference: { contains: search, mode: 'insensitive' } },
            ];
        }
        const items = await this.prisma.inventory_items.findMany({
            where,
            select: { id: true, sku: true, name: true, reference: true },
            orderBy: { sku: 'asc' },
        });
        const units = await this.prisma.inventory_units.findMany({
            where: { tenantId },
            select: { inventoryItemId: true, status: true },
        });
        const byItem = new Map();
        for (const u of units) {
            let c = byItem.get(u.inventoryItemId);
            if (!c) {
                c = { available: 0, reserved: 0, inTransit: 0, delivered: 0 };
                byItem.set(u.inventoryItemId, c);
            }
            switch (u.status) {
                case client_1.InventoryUnitStatus.Available:
                    c.available++;
                    break;
                case client_1.InventoryUnitStatus.Reserved:
                    c.reserved++;
                    break;
                case client_1.InventoryUnitStatus.InTransit:
                    c.inTransit++;
                    break;
                case client_1.InventoryUnitStatus.Delivered:
                    c.delivered++;
                    break;
            }
        }
        return items.map((item) => {
            const c = byItem.get(item.id) ?? {
                available: 0,
                reserved: 0,
                inTransit: 0,
                delivered: 0,
            };
            const total = c.available + c.reserved + c.inTransit + c.delivered;
            return {
                id: item.id,
                sku: item.sku,
                name: item.name,
                reference: item.reference,
                counts: {
                    available: c.available,
                    reserved: c.reserved,
                    inTransit: c.inTransit,
                    delivered: c.delivered,
                    total,
                },
            };
        });
    }
    async searchItems(tenantId, search) {
        const where = { tenantId };
        if (search) {
            where.OR = [
                { sku: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { reference: { contains: search, mode: 'insensitive' } },
            ];
        }
        const items = await this.prisma.inventory_items.findMany({
            where,
            select: {
                id: true,
                sku: true,
                name: true,
                reference: true,
            },
            orderBy: { sku: 'asc' },
        });
        return items.map((item) => ({
            id: item.id,
            sku: item.sku,
            name: item.name,
            reference: item.reference,
        }));
    }
    async createBatch(tenantId, dto) {
        let batchCode = dto.batchCode?.trim();
        if (!batchCode) {
            const now = new Date();
            const yy = String(now.getFullYear()).slice(-2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const prefix = `B${yy}${mm}${dd}-`;
            const todayCount = await this.prisma.inventory_batches.count({
                where: {
                    tenantId,
                    batchCode: { startsWith: prefix },
                },
            });
            const seq = (todayCount + 1).toString().padStart(3, '0');
            batchCode = `${prefix}${seq}`;
        }
        const existing = await this.prisma.inventory_batches.findUnique({
            where: {
                tenantId_batchCode: {
                    tenantId,
                    batchCode,
                },
            },
        });
        if (existing) {
            throw new common_1.ConflictException(`Batch with code ${batchCode} already exists`);
        }
        const batch = await this.prisma.inventory_batches.create({
            data: {
                tenantId,
                batchCode,
                notes: dto.notes ?? null,
                status: client_1.InventoryBatchStatus.Draft,
            },
        });
        return this.toBatchDto(batch, {
            totalUnits: 0,
            availableUnits: 0,
            reservedUnits: 0,
            inTransitUnits: 0,
            deliveredUnits: 0,
        });
    }
    async receiveStock(tenantId, batchId, dto) {
        const batch = await this.prisma.inventory_batches.findFirst({
            where: { id: batchId, tenantId },
        });
        if (!batch) {
            throw new common_1.NotFoundException('Batch not found');
        }
        if (batch.status === client_1.InventoryBatchStatus.Cancelled) {
            throw new common_1.BadRequestException('Cannot receive into a cancelled batch');
        }
        const format = dto.unitSkuFormat === 'ITEM-SEQ' ? 'ITEM-SEQ' : 'ITEM-BATCH-SEQ';
        return await this.prisma.$transaction(async (tx) => {
            const resultItems = [];
            let totalUnitsCreated = 0;
            for (const line of dto.items) {
                if (line.quantity < 1) {
                    throw new common_1.BadRequestException(`Quantity must be > 0 for item ${line.inventoryItemId}`);
                }
                const item = await tx.inventory_items.findFirst({
                    where: { id: line.inventoryItemId, tenantId },
                });
                if (!item) {
                    throw new common_1.NotFoundException(`Inventory item not found: ${line.inventoryItemId}`);
                }
                const existingBatchItem = await tx.inventory_batch_items.findUnique({
                    where: {
                        batchId_inventoryItemId: {
                            batchId,
                            inventoryItemId: line.inventoryItemId,
                        },
                    },
                });
                let totalInBatch;
                if (existingBatchItem) {
                    totalInBatch = existingBatchItem.qty + line.quantity;
                    await tx.inventory_batch_items.update({
                        where: { id: existingBatchItem.id },
                        data: { qty: totalInBatch, updatedAt: new Date() },
                    });
                }
                else {
                    totalInBatch = line.quantity;
                    await tx.inventory_batch_items.create({
                        data: {
                            tenantId,
                            batchId,
                            inventoryItemId: line.inventoryItemId,
                            qty: line.quantity,
                        },
                    });
                }
                const existingUnits = await tx.inventory_units.findMany({
                    where: {
                        tenantId,
                        batchId,
                        inventoryItemId: line.inventoryItemId,
                    },
                    select: { unitSku: true },
                    orderBy: { createdAt: 'desc' },
                });
                const unitsToCreate = [];
                const baseSeq = format === 'ITEM-BATCH-SEQ'
                    ? existingUnits.length + 1
                    : await this.getNextItemSeqForTenant(tx, tenantId, line.inventoryItemId);
                for (let i = 0; i < line.quantity; i++) {
                    const seq = format === 'ITEM-BATCH-SEQ'
                        ? existingUnits.length + 1 + i
                        : baseSeq + i;
                    const padded = seq.toString().padStart(4, '0');
                    const unitSku = format === 'ITEM-BATCH-SEQ'
                        ? `${item.sku}-${batch.batchCode}-${padded}`
                        : `${item.sku}-${padded}`;
                    const exists = await tx.inventory_units.findUnique({
                        where: {
                            tenantId_unitSku: { tenantId, unitSku },
                        },
                    });
                    if (exists) {
                        throw new common_1.ConflictException(`Unit SKU already exists: ${unitSku}. Use a different unitSkuFormat or batch.`);
                    }
                    unitsToCreate.push({
                        tenantId,
                        inventoryItemId: line.inventoryItemId,
                        batchId,
                        unitSku,
                        status: client_1.InventoryUnitStatus.Available,
                    });
                }
                await tx.inventory_units.createMany({
                    data: unitsToCreate,
                });
                totalUnitsCreated += line.quantity;
                resultItems.push({
                    inventoryItemId: line.inventoryItemId,
                    sku: item.sku,
                    name: item.name,
                    receivedQty: line.quantity,
                    totalInBatch,
                });
            }
            if (batch.status === client_1.InventoryBatchStatus.Draft) {
                await tx.inventory_batches.update({
                    where: { id: batchId },
                    data: {
                        status: client_1.InventoryBatchStatus.Open,
                        receivedAt: new Date(),
                    },
                });
            }
            for (const it of resultItems) {
                await this.updateAvailableQty(tenantId, it.inventoryItemId, tx);
            }
            return {
                items: resultItems,
                totalUnitsCreated,
            };
        });
    }
    async getNextItemSeqForTenant(tx, tenantId, inventoryItemId) {
        const units = await tx.inventory_units.findMany({
            where: { tenantId, inventoryItemId },
            select: { unitSku: true },
        });
        let maxSeq = 0;
        for (const u of units) {
            const match = u.unitSku.match(/-(\d+)$/);
            if (match) {
                const n = parseInt(match[1], 10);
                if (n > maxSeq)
                    maxSeq = n;
            }
        }
        return maxSeq + 1;
    }
    async getBatchSummary(tenantId, batchId) {
        const batch = await this.prisma.inventory_batches.findFirst({
            where: { id: batchId, tenantId },
            include: {
                inventory_batch_items: {
                    include: { inventory_item: true },
                },
            },
        });
        if (!batch) {
            throw new common_1.NotFoundException('Batch not found');
        }
        const unitCounts = await this.prisma.inventory_units.groupBy({
            by: ['inventoryItemId', 'status'],
            where: { tenantId, batchId },
            _count: { id: true },
        });
        const byItem = new Map();
        for (const row of unitCounts) {
            let c = byItem.get(row.inventoryItemId);
            if (!c) {
                c = { available: 0, reserved: 0, inTransit: 0, delivered: 0 };
                byItem.set(row.inventoryItemId, c);
            }
            const count = row._count?.id ?? 0;
            switch (row.status) {
                case client_1.InventoryUnitStatus.Available:
                    c.available = count;
                    break;
                case client_1.InventoryUnitStatus.Reserved:
                    c.reserved = count;
                    break;
                case client_1.InventoryUnitStatus.InTransit:
                    c.inTransit = count;
                    break;
                case client_1.InventoryUnitStatus.Delivered:
                    c.delivered = count;
                    break;
            }
        }
        const items = batch.inventory_batch_items.map((bi) => {
            const c = byItem.get(bi.inventoryItemId) ?? {
                available: 0,
                reserved: 0,
                inTransit: 0,
                delivered: 0,
            };
            const total = c.available + c.reserved + c.inTransit + c.delivered;
            return {
                inventoryItemId: bi.inventoryItemId,
                sku: bi.inventory_item.sku,
                name: bi.inventory_item.name,
                counts: {
                    available: c.available,
                    reserved: c.reserved,
                    inTransit: c.inTransit,
                    delivered: c.delivered,
                    total,
                },
            };
        });
        return {
            id: batch.id,
            batchCode: batch.batchCode,
            status: batch.status,
            items,
        };
    }
    async receiveUnits(tenantId, batchId, dto) {
        const batch = await this.prisma.inventory_batches.findFirst({
            where: { id: batchId, tenantId },
        });
        if (!batch) {
            throw new common_1.NotFoundException('Batch not found');
        }
        if (batch.status === client_1.InventoryBatchStatus.Cancelled) {
            throw new common_1.BadRequestException('Cannot receive units into a cancelled batch');
        }
        return await this.prisma.$transaction(async (tx) => {
            let inventoryItem = await tx.inventory_items.findUnique({
                where: {
                    tenantId_sku: {
                        tenantId,
                        sku: dto.inventorySku,
                    },
                },
            });
            if (!inventoryItem) {
                inventoryItem = await tx.inventory_items.create({
                    data: {
                        id: this.generateId(),
                        tenantId,
                        sku: dto.inventorySku,
                        name: dto.inventoryName || dto.inventorySku,
                        reference: dto.reference || null,
                        availableQty: 0,
                    },
                });
            }
            const unitSkus = [];
            const prefix = dto.unitSkuPrefix || `${batch.batchCode}-${dto.inventorySku}`;
            const existingUnits = await tx.inventory_units.findMany({
                where: {
                    tenantId,
                    batchId,
                    inventoryItemId: inventoryItem.id,
                    unitSku: { startsWith: prefix },
                },
                orderBy: { createdAt: 'desc' },
                take: 1,
            });
            let startSeq = 1;
            if (existingUnits.length > 0) {
                const lastSku = existingUnits[0].unitSku;
                const match = lastSku.match(/-(\d+)$/);
                if (match) {
                    startSeq = parseInt(match[1], 10) + 1;
                }
            }
            const unitsToCreate = [];
            for (let i = 0; i < dto.quantity; i++) {
                const seq = startSeq + i;
                const unitSku = `${prefix}-${seq.toString().padStart(4, '0')}`;
                unitSkus.push(unitSku);
                const existing = await tx.inventory_units.findUnique({
                    where: {
                        tenantId_unitSku: {
                            tenantId,
                            unitSku,
                        },
                    },
                });
                if (existing) {
                    throw new common_1.ConflictException(`Unit SKU ${unitSku} already exists`);
                }
                unitsToCreate.push({
                    tenantId,
                    inventoryItemId: inventoryItem.id,
                    batchId,
                    unitSku,
                    status: client_1.InventoryUnitStatus.Available,
                });
            }
            await tx.inventory_units.createMany({
                data: unitsToCreate,
            });
            await this.updateAvailableQty(tenantId, inventoryItem.id, tx);
            return {
                batchId,
                unitsCreated: dto.quantity,
                unitSkus,
            };
        });
    }
    async listBatches(tenantId, customerName, status) {
        const where = { tenantId };
        if (customerName) {
            where.customerName = { contains: customerName, mode: 'insensitive' };
        }
        if (status) {
            where.status = status;
        }
        const batches = await this.prisma.inventory_batches.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
        const batchesWithCounts = await Promise.all(batches.map(async (batch) => {
            const counts = await this.getBatchCounts(tenantId, batch.id);
            return this.toBatchDto(batch, counts);
        }));
        return batchesWithCounts;
    }
    async getBatchById(tenantId, batchId) {
        const batch = await this.prisma.inventory_batches.findFirst({
            where: { id: batchId, tenantId },
        });
        if (!batch) {
            throw new common_1.NotFoundException('Batch not found');
        }
        const counts = await this.getBatchCounts(tenantId, batchId);
        return this.toBatchDto(batch, counts);
    }
    async reserveItems(tenantId, orderId, dto) {
        const order = await this.prisma.transportOrder.findFirst({
            where: { id: orderId, tenantId },
        });
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return await this.prisma.$transaction(async (tx) => {
            const reservedItems = [];
            let totalReserved = 0;
            for (const item of dto.items) {
                const inventoryItem = await tx.inventory_items.findUnique({
                    where: {
                        tenantId_sku: {
                            tenantId,
                            sku: item.inventorySku,
                        },
                    },
                });
                if (!inventoryItem) {
                    throw new common_1.NotFoundException(`Inventory item with SKU ${item.inventorySku} not found`);
                }
                const unitWhere = {
                    tenantId,
                    inventoryItemId: inventoryItem.id,
                    status: client_1.InventoryUnitStatus.Available,
                };
                if (item.batchId) {
                    unitWhere.batchId = item.batchId;
                }
                const availableUnits = await tx.inventory_units.findMany({
                    where: unitWhere,
                    orderBy: { createdAt: 'asc' },
                    take: item.qty,
                });
                if (availableUnits.length < item.qty) {
                    throw new common_1.BadRequestException(`Insufficient available units for SKU ${item.inventorySku}. Available: ${availableUnits.length}, Requested: ${item.qty}`);
                }
                const unitIds = availableUnits.map((u) => u.id);
                await tx.inventory_units.updateMany({
                    where: {
                        id: { in: unitIds },
                    },
                    data: {
                        status: client_1.InventoryUnitStatus.Reserved,
                        transportOrderId: orderId,
                    },
                });
                const existingItem = await tx.transport_order_items.findUnique({
                    where: {
                        transportOrderId_inventoryItemId: {
                            transportOrderId: orderId,
                            inventoryItemId: inventoryItem.id,
                        },
                    },
                });
                if (existingItem) {
                    await tx.transport_order_items.update({
                        where: { id: existingItem.id },
                        data: {
                            qty: item.qty,
                            batchId: item.batchId || null,
                        },
                    });
                }
                else {
                    await tx.transport_order_items.create({
                        data: {
                            tenantId,
                            transportOrderId: orderId,
                            inventoryItemId: inventoryItem.id,
                            batchId: item.batchId || null,
                            qty: item.qty,
                        },
                    });
                }
                await this.updateAvailableQty(tenantId, inventoryItem.id, tx);
                reservedItems.push({
                    inventorySku: item.inventorySku,
                    qty: item.qty,
                    unitSkus: availableUnits.map((u) => u.unitSku),
                });
                totalReserved += item.qty;
            }
            return {
                reserved: totalReserved,
                items: reservedItems,
            };
        });
    }
    async dispatchItems(tenantId, orderId, dto) {
        const order = await this.prisma.transportOrder.findFirst({
            where: { id: orderId, tenantId },
        });
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return await this.prisma.$transaction(async (tx) => {
            const where = {
                tenantId,
                transportOrderId: orderId,
                status: client_1.InventoryUnitStatus.Reserved,
            };
            if (dto.unitSkus && dto.unitSkus.length > 0) {
                where.unitSku = { in: dto.unitSkus };
            }
            const units = await tx.inventory_units.findMany({ where });
            if (units.length === 0) {
                throw new common_1.BadRequestException('No reserved units found for this order');
            }
            const updateData = {
                status: client_1.InventoryUnitStatus.InTransit,
            };
            if (dto.tripId) {
                updateData.tripId = dto.tripId;
            }
            if (dto.stopId) {
                updateData.stopId = dto.stopId;
            }
            await tx.inventory_units.updateMany({
                where: { id: { in: units.map((u) => u.id) } },
                data: updateData,
            });
            const itemIds = [...new Set(units.map((u) => u.inventoryItemId))];
            for (const itemId of itemIds) {
                await this.updateAvailableQty(tenantId, itemId, tx);
            }
            return { dispatched: units.length };
        });
    }
    async deliverItems(tenantId, orderId, dto) {
        const order = await this.prisma.transportOrder.findFirst({
            where: { id: orderId, tenantId },
        });
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return await this.prisma.$transaction(async (tx) => {
            const where = {
                tenantId,
                transportOrderId: orderId,
                status: client_1.InventoryUnitStatus.InTransit,
            };
            if (dto.unitSkus && dto.unitSkus.length > 0) {
                where.unitSku = { in: dto.unitSkus };
            }
            const units = await tx.inventory_units.findMany({ where });
            if (units.length === 0) {
                throw new common_1.BadRequestException('No in-transit units found for this order');
            }
            await tx.inventory_units.updateMany({
                where: { id: { in: units.map((u) => u.id) } },
                data: {
                    status: client_1.InventoryUnitStatus.Delivered,
                },
            });
            const itemIds = [...new Set(units.map((u) => u.inventoryItemId))];
            for (const itemId of itemIds) {
                await this.updateAvailableQty(tenantId, itemId, tx);
            }
            return { delivered: units.length };
        });
    }
    async cancelReservation(tenantId, orderId) {
        const order = await this.prisma.transportOrder.findFirst({
            where: { id: orderId, tenantId },
        });
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return await this.prisma.$transaction(async (tx) => {
            const units = await tx.inventory_units.findMany({
                where: {
                    tenantId,
                    transportOrderId: orderId,
                    status: client_1.InventoryUnitStatus.Reserved,
                },
            });
            if (units.length === 0) {
                return { released: 0 };
            }
            await tx.inventory_units.updateMany({
                where: {
                    id: { in: units.map((u) => u.id) },
                },
                data: {
                    status: client_1.InventoryUnitStatus.Available,
                    transportOrderId: null,
                },
            });
            const itemIds = [...new Set(units.map((u) => u.inventoryItemId))];
            for (const itemId of itemIds) {
                await this.updateAvailableQty(tenantId, itemId, tx);
            }
            return { released: units.length };
        });
    }
    async getBatchCounts(tenantId, batchId) {
        const [total, available, reserved, inTransit, delivered] = await Promise.all([
            this.prisma.inventory_units.count({
                where: { tenantId, batchId },
            }),
            this.prisma.inventory_units.count({
                where: {
                    tenantId,
                    batchId,
                    status: client_1.InventoryUnitStatus.Available,
                },
            }),
            this.prisma.inventory_units.count({
                where: {
                    tenantId,
                    batchId,
                    status: client_1.InventoryUnitStatus.Reserved,
                },
            }),
            this.prisma.inventory_units.count({
                where: {
                    tenantId,
                    batchId,
                    status: client_1.InventoryUnitStatus.InTransit,
                },
            }),
            this.prisma.inventory_units.count({
                where: {
                    tenantId,
                    batchId,
                    status: client_1.InventoryUnitStatus.Delivered,
                },
            }),
        ]);
        return {
            totalUnits: total,
            availableUnits: available,
            reservedUnits: reserved,
            inTransitUnits: inTransit,
            deliveredUnits: delivered,
        };
    }
    toBatchDto(batch, counts) {
        return {
            id: batch.id,
            batchCode: batch.batchCode,
            customerName: batch.customerName,
            customerRef: batch.customerRef,
            receivedAt: batch.receivedAt,
            notes: batch.notes,
            status: batch.status,
            createdAt: batch.createdAt,
            updatedAt: batch.updatedAt,
            ...counts,
        };
    }
    generateId() {
        return `cl${Date.now().toString(36)}${Math.random().toString(36).substr(2, 9)}`;
    }
};
exports.InventoryService = InventoryService;
exports.InventoryService = InventoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], InventoryService);
//# sourceMappingURL=inventory.service.js.map