import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "../../../prisma");

function stripSqlComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

describe("Phase 1 trip document requirement migrations", () => {
  const schema = readFileSync(join(root, "schema.prisma"), "utf8");
  const columnsMigration = readFileSync(
    join(
      root,
      "migrations/20260820170000_trip_document_requirement_stage_uploader_permit/migration.sql",
    ),
    "utf8",
  );
  const uniqueMigration = readFileSync(
    join(
      root,
      "migrations/20260820180000_trip_document_requirement_unique_tenant_trip_type_stage/migration.sql",
    ),
    "utf8",
  );
  const postColumnPreflight = readFileSync(
    join(
      root,
      "migrations/20260820180000_trip_document_requirement_unique_tenant_trip_type_stage/preflight.sql",
    ),
    "utf8",
  );
  const preMigrationPreflight = readFileSync(
    join(
      __dirname,
      "../../../scripts/sql/preflight-trip-document-requirement-collisions-pre-migration.sql",
    ),
    "utf8",
  );
  const readme = readFileSync(
    join(root, "migrations/README-phase1-trip-document-requirements.md"),
    "utf8",
  );

  it("schema declares uploader/stage columns and the canonical unique key", () => {
    expect(schema).toMatch(/enum TripDocumentResponsibleUploader/);
    expect(schema).toMatch(/enum TripDocumentRequirementStage/);
    expect(schema).toContain("responsibleUploader");
    expect(schema).toContain("requirementStage");
    expect(schema).toContain(
      '@@unique([tenantId, tripId, type, requirementStage], map: "trip_document_requirements_tenant_trip_type_stage_key")',
    );
  });

  it("170000 adds enums/columns only; 180000 adds the unique index only", () => {
    expect(columnsMigration).toContain("ADD VALUE 'PERMIT'");
    expect(columnsMigration).toContain('"TripDocumentResponsibleUploader"');
    expect(columnsMigration).toContain('"TripDocumentRequirementStage"');
    expect(columnsMigration).toContain('ADD COLUMN "responsibleUploader"');
    expect(columnsMigration).toContain('ADD COLUMN "requirementStage"');
    expect(columnsMigration).not.toMatch(/CREATE UNIQUE INDEX/i);

    expect(uniqueMigration).toContain(
      'CREATE UNIQUE INDEX "trip_document_requirements_tenant_trip_type_stage_key"',
    );
    expect(uniqueMigration).toContain(
      'ON "trip_document_requirements" ("tenantId", "tripId", "type", "requirementStage")',
    );
    expect(uniqueMigration).not.toMatch(/ADD COLUMN/i);
  });

  it("pre-migration collision SQL is read-only and omits Phase 1 columns in executable SQL", () => {
    const executable = stripSqlComments(preMigrationPreflight);
    expect(executable).toMatch(/\bSELECT\b/i);
    expect(executable).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
    expect(executable).not.toMatch(/requirementStage/i);
    expect(executable).not.toMatch(/responsibleUploader/i);
    expect(executable).not.toMatch(/TripDocumentResponsibleUploader/i);
    expect(executable).not.toMatch(/TripDocumentRequirementStage/i);
    expect(executable).toMatch(/BEFORE_COMPLETE/);
    expect(executable).toMatch(/"tenantId"/);
    expect(executable).toMatch(/"tripId"/);
    expect(executable).toMatch(/"type"/);
    expect(preMigrationPreflight).toMatch(/EXECUTION POINT:\s*BEFORE applying either/i);
  });

  it("post-column preflight is labeled optional and references requirementStage", () => {
    const executable = stripSqlComments(postColumnPreflight);
    expect(postColumnPreflight).toMatch(/OPTIONAL POST-COLUMN \/ PRE-INDEX/i);
    expect(executable).toMatch(/requirementStage/);
    expect(executable).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  });

  it("README documents the required pre-migration gate before migrate deploy", () => {
    expect(readme).toContain(
      "preflight-trip-document-requirement-collisions-pre-migration.sql",
    );
    expect(readme).toMatch(/if any duplicate rows are returned/i);
    expect(readme).toMatch(/prisma migrate deploy/i);
    expect(readme).not.toMatch(/DELETE FROM "trip_document_requirements"/i);
  });
});
