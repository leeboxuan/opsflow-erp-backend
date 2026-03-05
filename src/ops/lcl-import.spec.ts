/**
 * LCL Order In import – grouping by Order Ref.
 * Run: npx jest src/ops/lcl-import.e2e-spec.ts
 */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SupabaseService } from "../auth/supabase.service";
import { OpsJobsService } from "./ops-jobs.service";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx");

function buildLclExcelBuffer(rows: any[]): Buffer {
  const headers = [
    "Order Ref",
    "First Name",
    "Last Name",
    "Phone",
    "Mobile",
    "Delivery First Name",
    "Delivery Last Name",
    "Delivery Address 1",
    "Delivery Address 2",
    "Delivery City",
    "Delivery Postal Code",
    "Delivery Country",
    "Item Code",
    "Item Qty",
    "Special Request",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Batch 3");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("LCL Import – grouping by Order Ref", () => {
  let service: OpsJobsService;
  const tenantId = "tenant-1";
  const customerCompanyId = "company-1";

  beforeEach(async () => {
    const mockPrisma = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: customerCompanyId }),
      },
    };
    const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    const mockSupabase = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpsJobsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<OpsJobsService>(OpsJobsService);
  });

  it("groups multiple rows with same Order Ref into one preview job", async () => {
    const rows = [
      {
        "Order Ref": "ORD-001",
        "First Name": "John",
        "Last Name": "Doe",
        "Phone": "65123456",
        "Mobile": "91234567",
        "Delivery First Name": "Jane",
        "Delivery Last Name": "Doe",
        "Delivery Address 1": "123 Delivery St",
        "Delivery Address 2": "Unit 4",
        "Delivery City": "Singapore",
        "Delivery Postal Code": "123456",
        "Delivery Country": "SG",
        "Item Code": "LLSG-CB-Q-DGY",
        "Item Qty": "2",
        "Special Request": "Handle with care",
      },
      {
        "Order Ref": "ORD-001",
        "First Name": "John",
        "Last Name": "Doe",
        "Phone": "65123456",
        "Mobile": "91234567",
        "Delivery First Name": "Jane",
        "Delivery Last Name": "Doe",
        "Delivery Address 1": "123 Delivery St",
        "Delivery Address 2": "",
        "Delivery City": "Singapore",
        "Delivery Postal Code": "123456",
        "Delivery Country": "SG",
        "Item Code": "LLSG-CB-S-DGY",
        "Item Qty": "1",
        "Special Request": "Fragile",
      },
    ];
    const buffer = buildLclExcelBuffer(rows);
    const result = await service.lclImportPreview(tenantId, buffer, {
      customerCompanyId,
      pickupDate: "2025-03-10",
      pickupAddress1: "456 Pickup Ave",
    });

    expect(result.template).toBe("LCL_ORDER_IN_BATCH");
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.rowKey).toBe("ORD-001");
    expect(row.externalRef).toBe("ORD-001");
    expect(row.receiverName).toBe("Jane Doe");
    expect(row.receiverPhone).toBe("91234567");
    expect(row.deliveryAddress1).toBe("123 Delivery St");
    expect(row.deliveryAddress2).toBe("Unit 4");
    expect(row.deliveryCity).toBe("Singapore");
    expect(row.deliveryPostal).toBe("123456");
    expect(row.deliveryCountry).toBe("SG");
    expect(row.itemsSummary).toContain("LLSG-CB-Q-DGY");
    expect(row.itemsSummary).toContain("x2");
    expect(row.itemsSummary).toContain("LLSG-CB-S-DGY");
    expect(row.itemsSummary).toContain("x1");
    expect(row.specialRequest).toContain("Handle with care");
    expect(row.specialRequest).toContain("Fragile");
    expect(row.errors).toEqual([]);
    expect(result.stats.total).toBe(1);
    expect(result.stats.valid).toBe(1);
    expect(result.stats.invalid).toBe(0);
  });

  it("produces one preview job per unique Order Ref", async () => {
    const rows = [
      {
        "Order Ref": "ORD-A",
        "First Name": "A",
        "Last Name": "A",
        "Phone": "111",
        "Mobile": "",
        "Delivery First Name": "DelA",
        "Delivery Last Name": "A",
        "Delivery Address 1": "Addr A",
        "Delivery Address 2": "",
        "Delivery City": "",
        "Delivery Postal Code": "",
        "Delivery Country": "SG",
        "Item Code": "ITEM1",
        "Item Qty": "1",
        "Special Request": "",
      },
      {
        "Order Ref": "ORD-B",
        "First Name": "B",
        "Last Name": "B",
        "Phone": "222",
        "Mobile": "82222222",
        "Delivery First Name": "DelB",
        "Delivery Last Name": "B",
        "Delivery Address 1": "Addr B",
        "Delivery Address 2": "",
        "Delivery City": "",
        "Delivery Postal Code": "",
        "Delivery Country": "SG",
        "Item Code": "ITEM2",
        "Item Qty": "3",
        "Special Request": "Note B",
      },
    ];
    const buffer = buildLclExcelBuffer(rows);
    const result = await service.lclImportPreview(tenantId, buffer, {
      customerCompanyId,
      pickupDate: "2025-03-10",
      pickupAddress1: "Pickup 1",
    });

    expect(result.rows).toHaveLength(2);
    const keys = result.rows.map((r) => r.rowKey).sort();
    expect(keys).toEqual(["ORD-A", "ORD-B"]);
    expect(result.rows.find((r) => r.rowKey === "ORD-A")?.itemsSummary).toContain("ITEM1");
    expect(result.rows.find((r) => r.rowKey === "ORD-B")?.itemsSummary).toContain("ITEM2");
    expect(result.rows.find((r) => r.rowKey === "ORD-B")?.specialRequest).toBe("Note B");
    expect(result.stats.total).toBe(2);
  });

  it("validates and marks rows with missing delivery or receiver as invalid", async () => {
    const rows = [
      {
        "Order Ref": "ORD-EMPTY",
        "First Name": "",
        "Last Name": "",
        "Phone": "",
        "Mobile": "",
        "Delivery First Name": "",
        "Delivery Last Name": "",
        "Delivery Address 1": "",
        "Delivery Address 2": "",
        "Delivery City": "",
        "Delivery Postal Code": "",
        "Delivery Country": "",
        "Item Code": "X",
        "Item Qty": "1",
        "Special Request": "",
      },
    ];
    const buffer = buildLclExcelBuffer(rows);
    const result = await service.lclImportPreview(tenantId, buffer, {
      customerCompanyId,
      pickupDate: "2025-03-10",
      pickupAddress1: "Pickup 1",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].errors.length).toBeGreaterThan(0);
    expect(result.rows[0].errors.some((e) => e.includes("deliveryAddress1"))).toBe(true);
    expect(result.rows[0].errors.some((e) => e.includes("receiverName"))).toBe(true);
    expect(result.stats.valid).toBe(0);
    expect(result.stats.invalid).toBe(1);
  });
});
