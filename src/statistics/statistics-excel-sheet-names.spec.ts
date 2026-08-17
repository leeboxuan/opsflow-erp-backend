import {
  createExcelWorksheetNameAllocator,
  EXCEL_WORKSHEET_NAME_MAX,
  sanitizeExcelWorksheetName,
} from "./statistics-excel-sheet-names";

describe("Excel worksheet name allocator", () => {
  it("keeps the first Summary and suffixes the second deterministically", () => {
    const names = createExcelWorksheetNameAllocator();
    expect(names.allocate("Summary")).toBe("Summary");
    expect(names.allocate("Summary")).toBe("Summary (2)");
    expect(names.allocate("Summary")).toBe("Summary (3)");
  });

  it("treats worksheet names as unique case-insensitively", () => {
    const names = createExcelWorksheetNameAllocator();
    expect(names.allocate("Summary")).toBe("Summary");
    expect(names.allocate("summary")).toBe("summary (2)");
    expect(names.allocate("SUMMARY")).toBe("SUMMARY (3)");
  });

  it("truncates names longer than 31 characters", () => {
    const names = createExcelWorksheetNameAllocator();
    const requested = "Container Movements Analysis Extra Detail";
    const allocated = names.allocate(requested);
    expect(allocated.length).toBeLessThanOrEqual(EXCEL_WORKSHEET_NAME_MAX);
    expect(allocated).toBe(requested.slice(0, EXCEL_WORKSHEET_NAME_MAX));
  });

  it("strips invalid Excel characters and rejects blank names", () => {
    const names = createExcelWorksheetNameAllocator();
    expect(names.allocate("Q1:Results?*[copy]")).toBe("Q1 Results copy");
    expect(names.allocate("Sum/mary\\Export")).toBe("Sum mary Export");
    expect(names.allocate("???")).toBe("Sheet");
    expect(names.allocate("   ")).toBe("Sheet (2)");
  });

  it("suffixes repeated truncated names without dropping either sheet", () => {
    const names = createExcelWorksheetNameAllocator();
    const first = "ABCDEFGHIJKLMNOPQRSTUVWXYZ12345EXTRA";
    const second = "ABCDEFGHIJKLMNOPQRSTUVWXYZ12345OTHER";
    const allocatedFirst = names.allocate(first);
    const allocatedSecond = names.allocate(second);
    expect(allocatedFirst).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ12345");
    expect(allocatedFirst.length).toBe(EXCEL_WORKSHEET_NAME_MAX);
    expect(allocatedSecond).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ1 (2)");
    expect(allocatedSecond.length).toBeLessThanOrEqual(EXCEL_WORKSHEET_NAME_MAX);
    expect(allocatedFirst.toLowerCase()).not.toBe(allocatedSecond.toLowerCase());
  });

  it("accounts for suffix length when the truncated base is already 31 characters", () => {
    const names = createExcelWorksheetNameAllocator();
    const longName = "A".repeat(40);
    expect(names.allocate(longName)).toBe("A".repeat(31));
    const second = names.allocate(longName);
    expect(second).toBe(`${"A".repeat(27)} (2)`);
    expect(second.length).toBe(EXCEL_WORKSHEET_NAME_MAX);
    const third = names.allocate(longName);
    expect(third).toBe(`${"A".repeat(27)} (3)`);
    expect(third.length).toBe(EXCEL_WORKSHEET_NAME_MAX);
  });

  it("sanitizes independently of allocation", () => {
    expect(sanitizeExcelWorksheetName("Finance: Q1/Q2")).toBe("Finance Q1 Q2");
    expect(sanitizeExcelWorksheetName("")).toBe("Sheet");
  });
});
