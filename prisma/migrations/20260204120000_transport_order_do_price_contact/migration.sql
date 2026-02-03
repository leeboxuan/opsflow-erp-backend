-- AlterTable: Add Driver App MVP fields to transport_orders (doNumber, priceCents, currency, customerName, contactName, contactPhone)
ALTER TABLE "transport_orders" ADD COLUMN "doNumber" TEXT;
ALTER TABLE "transport_orders" ADD COLUMN "priceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transport_orders" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SGD';
ALTER TABLE "transport_orders" ADD COLUMN "customerName" TEXT;
ALTER TABLE "transport_orders" ADD COLUMN "contactName" TEXT;
ALTER TABLE "transport_orders" ADD COLUMN "contactPhone" TEXT;
