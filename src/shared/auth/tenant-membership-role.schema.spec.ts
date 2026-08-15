import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("TenantMembershipRole schema", () => {
  const schema = readFileSync(
    join(__dirname, "../../../prisma/schema.prisma"),
    "utf8",
  );
  const migration = readFileSync(
    join(
      __dirname,
      "../../../prisma/migrations/20260815040000_tenant_membership_roles/migration.sql",
    ),
    "utf8",
  );

  it("stores canonical roles as relational rows with unique(membership, role)", () => {
    expect(schema).toContain("model TenantMembershipRole");
    expect(schema).toContain("@@unique([tenantMembershipId, role])");
    expect(schema).toContain("enum CanonicalTenantRole");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "tenant_membership_roles_tenantMembershipId_role_key"',
    );
  });

  it("backfills legacy roles without inventing WAREHOUSE_ADMIN", () => {
    expect(migration).toContain("WHEN 'WAREHOUSE' THEN 'WAREHOUSE_STAFF'");
    expect(migration).not.toMatch(/WAREHOUSE' THEN 'WAREHOUSE_ADMIN/);
    expect(migration).toContain("WHEN 'ADMIN' THEN 'TENANT_ADMIN'");
    expect(migration).toContain("WHEN 'DRIVER' THEN 'TRANSPORT_DRIVER'");
    expect(migration).toContain("ON CONFLICT (\"tenantMembershipId\", \"role\") DO NOTHING");
  });
});
