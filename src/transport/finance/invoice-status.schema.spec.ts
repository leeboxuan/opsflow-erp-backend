import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("InvoiceStatus schema and forward-only migration", () => {
  const root = join(__dirname, "../../../prisma");
  const schema = readFileSync(join(root, "schema.prisma"), "utf8");
  const migration = readFileSync(
    join(root, "migrations/20260817120000_invoice_status_enum/migration.sql"),
    "utf8",
  );
  const preflight = readFileSync(
    join(root, "migrations/20260817120000_invoice_status_enum/preflight.sql"),
    "utf8",
  );

  it("declares the canonical Prisma enum on Invoice.status", () => {
    expect(schema).toMatch(/enum InvoiceStatus \{[\s\S]*DRAFT[\s\S]*GENERATED[\s\S]*ISSUED[\s\S]*PAID[\s\S]*VOID/);
    expect(schema).toContain("status InvoiceStatus @default(DRAFT)");
    expect(schema).not.toMatch(/status String\s+@default\("Draft"\)/);
  });

  it("preflight is read-only grouped counts and does not infer GENERATED from pdfGeneratedAt", () => {
    expect(preflight).toMatch(/GROUP BY/i);
    expect(preflight).toMatch(/READ-ONLY/i);
    expect(preflight).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER)\b/i);
    expect(preflight).toMatch(/pdfGeneratedAt is NOT used to infer GENERATED/);
  });

  it("maps known strings, fails closed on unknown, and documents rollback limits", () => {
    expect(migration).toContain("WHEN 'DRAFT' THEN 'DRAFT'::\"InvoiceStatus\"");
    expect(migration).toContain("WHEN 'SENT' THEN 'ISSUED'::\"InvoiceStatus\"");
    expect(migration).toContain("WHEN 'ISSUED' THEN 'ISSUED'::\"InvoiceStatus\"");
    expect(migration).toContain("WHEN 'PAID' THEN 'PAID'::\"InvoiceStatus\"");
    expect(migration).toContain("WHEN 'VOID' THEN 'VOID'::\"InvoiceStatus\"");
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).toContain("unknown Invoice.status value");
    expect(migration).toContain("GENERATED is not inferred from pdfGeneratedAt");
    expect(migration).not.toMatch(/WHEN .*pdfGeneratedAt/);
    expect(migration).toMatch(/Rollback limitations/i);
    expect(migration).toContain('CREATE TYPE "InvoiceStatus" AS ENUM');
  });
});
