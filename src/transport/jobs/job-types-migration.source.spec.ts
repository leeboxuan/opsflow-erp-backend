import * as fs from "fs";
import * as path from "path";

const migrationDir = path.join(
  __dirname,
  "../../../prisma/migrations/20260820200000_job_types_trip_type",
);

describe("Phase 4 migration source / preflight (unapplied)", () => {
  it("required pre-migration preflight does not reference Phase 4-only objects", () => {
    const raw = fs.readFileSync(
      path.join(migrationDir, "preflight-pre-migration.sql"),
      "utf8",
    );
    // Strip SQL line comments so documentation may mention future objects.
    const sql = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/job_type_assignments/i);
    expect(sql).not.toMatch(/trips\.?"tripType"/i);
    expect(sql).not.toMatch(/"tripType"/);
    expect(sql).toMatch(/FROM "jobs"/);
    expect(sql).toMatch(/FROM "trips"/);
  });

  it("post-expand preflight may reference new table/column", () => {
    const sql = fs.readFileSync(
      path.join(migrationDir, "preflight-post-expand.sql"),
      "utf8",
    );
    expect(sql).toMatch(/job_type_assignments/);
    expect(sql).toMatch(/tripType/);
  });

  it("expand migration keeps Trip.tripType nullable (no SET NOT NULL)", () => {
    const sql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "tripType"/);
    expect(sql).not.toMatch(
      /^\s*ALTER TABLE "trips" ALTER COLUMN "tripType" SET NOT NULL/m,
    );
    expect(sql).toMatch(/job_type_assignments_tenantId_jobId_fkey/);
    expect(sql).toMatch(/jobs_tenantId_id_key/);
    expect(sql).toMatch(/ALTER COLUMN "jobType" DROP NOT NULL/);
  });
});
