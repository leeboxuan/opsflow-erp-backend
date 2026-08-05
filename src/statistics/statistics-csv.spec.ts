import {
  buildStatisticsExportFilename,
  encodeCsvCell,
  joinStatisticsLimitations,
  neutralizeSpreadsheetFormula,
  serializeStatisticsCsv,
} from "./statistics-csv";

function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else {
      cell += char;
    }
  }
  return rows;
}

describe("Statistics CSV safety", () => {
  it("escapes commas, quotes, line breaks, empty strings, and Unicode", () => {
    const csv = serializeStatisticsCsv(
      [
        { header: "Name", value: (row: string[]) => row[0] },
        { header: "Note", value: (row: string[]) => row[1] },
      ],
      [
        ['Ng, "Wei"', "first\r\nsecond"],
        ["司机 🚚", ""],
      ],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(parseCsv(csv)).toEqual([
      ["Name", "Note"],
      ['Ng, "Wei"', "first\r\nsecond"],
      ["司机 🚚", ""],
    ]);
    expect(parseCsv(csv).every((row) => row.length === 2)).toBe(true);
  });

  it.each(["=SUM(A1:A2)", "+1", "-2", "@cmd", "\tcmd", "\rcmd"])(
    "neutralizes dangerous text prefix %j",
    (value) => {
      expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);
      expect(encodeCsvCell(value)).toBe(`"'${value.replace(/\r/g, "\r")}"`);
    },
  );

  it("keeps numeric negatives numeric and distinguishes null from zero", () => {
    const csv = serializeStatisticsCsv(
      [{ header: "Value", value: (row: number | null) => row }],
      [0, null, -25, Number.MAX_SAFE_INTEGER],
    );
    expect(parseCsv(csv)).toEqual([
      ["Value"],
      ["0"],
      [""],
      ["-25"],
      [String(Number.MAX_SAFE_INTEGER)],
    ]);
  });

  it("orders limitations deterministically and preserves unknown keys", () => {
    expect(joinStatisticsLimitations(["z_unknown", "a_known"])).toBe(
      "a_known | z_unknown",
    );
    expect(joinStatisticsLimitations([])).toBe("");
  });

  it("builds fixed safe filenames", () => {
    expect(
      buildStatisticsExportFilename("drivers", "2026-08-01", "2026-08-31"),
    ).toBe("opsflow-statistics-drivers-2026-08-01-to-2026-08-31.csv");
    expect(
      buildStatisticsExportFilename("finance", "bad\r\nname", "2026-08-31"),
    ).toBe("opsflow-statistics-finance-unknown-date-to-2026-08-31.csv");
  });
});
